"""Compose pinned Git trees locally. Run from the root of a clean app worktree."""

import argparse
from functools import lru_cache
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unicodedata


LOCK = "integration/modules.lock.json"
OWNERSHIP = "integration/ownership.json"
REGULAR = {"100644", "100755"}
ZERO = "0" * 40


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(repo, *args, data=None, index=None):
    env = dict(os.environ)
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
                "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(key, None)
    env.update(GIT_NO_LAZY_FETCH="1", GIT_NO_REPLACE_OBJECTS="1", GIT_ALLOW_PROTOCOL="")
    if index:
        env["GIT_INDEX_FILE"] = str(index)
    result = subprocess.run(["git", "-C", str(repo), *args], input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors="replace").strip() or f"git {args[0]} failed")
    return result.stdout


def scalar(repo, *args, **kwargs):
    return git(repo, *args, **kwargs).decode("utf-8").strip()


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_json(data):
    return json.loads(data, object_pairs_hook=unique_keys)


def sha(value):
    require(isinstance(value, str) and re.fullmatch("[0-9a-f]{40}", value),
            f"Expected full lowercase commit SHA: {value}")
    return value


def safe_path(path):
    require(isinstance(path, str) and path, "Expected a non-empty relative path")
    for part in path.split("/"):
        portable = unicodedata.normalize("NFKC", part).casefold()
        require(portable and not portable.endswith((".", " ")) and portable != ".git"
                and not re.search(r'[<>:"/\\|?*\x00-\x1f\x7f]|~[0-9]', portable)
                and not re.fullmatch(r"(con|prn|aux|nul|conin\$|conout\$|com[0-9]|lpt[0-9])(\..*)?", portable),
                f"Unsafe Git/Windows path: {path!r}")
    return path


def namespace(paths):
    # Include directories to catch A/x vs a/y and a symlink/file used as a directory.
    names = {}
    for path in paths:
        parts = safe_path(path).split("/")
        for depth in range(1, len(parts) + 1):
            prefix = "/".join(parts[:depth])
            key = unicodedata.normalize("NFKC", prefix).casefold()
            entry = (prefix, depth == len(parts))
            require(names.setdefault(key, entry) == entry, f"Path collision: {prefix}")


@lru_cache(maxsize=None)
def tree(repo, commit):
    sha(commit)
    require(scalar(repo, "cat-file", "-t", commit) == "commit", f"Missing commit {commit} in {repo}")
    rows = {}
    for item in git(repo, "ls-tree", "-rz", commit).split(b"\0"):
        if item:
            meta, name = item.split(b"\t", 1)
            mode, _, oid = meta.decode("ascii").split()
            rows[name.decode("utf-8")] = (mode, oid)
    return rows


def clean_base(repo, base):
    require(scalar(repo, "rev-parse", "HEAD") == base, "HEAD differs from --base")
    tracked = git(repo, "ls-files", "-v", "-z").split(b"\0")
    require(all(not row or row[:1] == b"H" for row in tracked),
            "Use a full clean worktree without skip-worktree or assume-unchanged entries")
    require(not git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all",
                    "--ignore-submodules=none"), "Integration worktree has local changes")


def map_owners(manifest):
    result = {}
    targets = set()
    excluded = set()
    for owner, desc in manifest["owners"].items():
        require(re.fullmatch("[a-z][a-z0-9-]*", owner), f"Invalid module: {owner}")
        entries = [(p, p) for p in desc["identityPaths"]]
        entries.extend((m["source"], m["target"]) for m in desc["mappings"])
        result[owner] = {}
        excluded.update(safe_path(p) for p, reason in desc["localOnly"].items()
                        if not reason.startswith("reference:"))
        for source, target in entries:
            safe_path(source)
            safe_path(target)
            require(not target.startswith(("integration/", "scripts/integration/")),
                    f"Reserved integration target: {target}")
            require(source not in desc["localOnly"] and source not in result[owner],
                    f"Duplicate or excluded source: {owner}/{source}")
            require(target not in targets, f"Two owners for target: {target}")
            result[owner][source] = target
            targets.add(target)
    require(not targets.intersection(excluded), "An import target overlaps a local-only file")
    namespace(targets | excluded)
    return result


def regular_entry(entries, path):
    # A missing file is different from a path hidden behind a file or symlink.
    parts = path.split("/")
    for n in range(1, len(parts)):
        require("/".join(parts[:n]) not in entries, f"Non-directory ancestor: {path}")
    value = entries.get(path)
    require(not value or value[0] in REGULAR, f"Unsupported Git mode: {path}")
    return value


def check_local_targets(app, changes, actual):
    for target in changes:
        current = app
        for part in target.split("/"):
            current /= part
            try:
                info = current.lstat()
            except FileNotFoundError:
                break
            reparse = getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
            require(not reparse and not stat.S_ISLNK(info.st_mode), f"Local link or junction: {current}")
            if current == app / target:
                require(target in actual and stat.S_ISREG(info.st_mode), f"Occupied destination: {current}")
            else:
                require(stat.S_ISDIR(info.st_mode), f"Non-directory ancestor: {current}")


def load_composition(repos, app, base, ownership, lock):
    require(set(ownership) == set(lock["modules"]), "Module lists disagree")
    require(lock["appBase"] == lock["modules"]["app"]["baseCommit"], "Unexpected app base")
    actual = tree(app, base)
    originals = {}
    for owner, files in ownership.items():
        repo = repos / owner
        module = lock["modules"][owner]
        tree(repo, module["baseCommit"])  # Includes modules with local-only files.
        overrides = module["pathCommits"]
        deleted = set(module["deleted"])
        require(set(overrides) <= files.keys() and deleted <= overrides.keys(), f"Invalid lock: {owner}")
        for source, target in files.items():
            pinned = tree(repo, overrides.get(source, module["baseCommit"]))
            value = regular_entry(pinned, source)
            require(source not in deleted or value is None, f"Unexpected live file: {owner}/{source}")
            require(regular_entry(actual, target) == value,
                    f"Destination differs from its locked source: {target}")
            originals[target] = value
    namespace(set(actual) | set(originals))
    return actual, originals


def migration_paths(paths):
    return {p for p in paths if p.startswith("supabase/migrations/") and p.endswith(".sql")}


def check_order(order, paths):
    require(isinstance(order, list) and len(order) == len(set(order))
            and set(order) == migration_paths(paths), "migrationOrder must list each composed migration once")


def prepare_request(repos, ownership, originals, lock, request):
    allowed = {"module", "commit", "paths", "delete", "contractVersion", "audioRelease", "migrationOrder"}
    require(not request.keys() - allowed, "Unknown request field")
    owner = request["module"]
    require(owner in ownership, f"Unknown owner: {owner}")
    repo = repos / owner
    commit = sha(request["commit"])
    source_tree = tree(repo, commit)
    paths, deletions = request["paths"], request.get("delete", [])
    require(isinstance(paths, list) and isinstance(deletions, list), "paths and delete must be lists")
    selected = paths + deletions
    require(selected and len(selected) == len(set(selected)), "Empty or duplicate selection")
    namespace(set(source_tree) | set(selected))
    module = lock["modules"][owner]
    deleted = set(module["deleted"])
    changes = {}
    for source in selected:
        require(source in ownership[owner], f"Unregistered source: {owner}/{source}")
        target = ownership[owner][source]
        value = regular_entry(source_tree, source)
        if source in deletions:
            require(value is None and originals[target] is not None,
                    f"Deletion requires a previously imported file absent from the submitted commit: {source}")
            deleted.add(source)
        else:
            require(value, f"Missing submitted file: {source}")
            deleted.discard(source)
        module["pathCommits"][source] = commit
        changes[target] = value
    module["deleted"] = sorted(deleted)
    module["pathCommits"] = dict(sorted(module["pathCommits"].items()))
    for key in ("contractVersion", "audioRelease"):
        if key in request:
            require(isinstance(request[key], str) and request[key].strip(), f"Missing {key}")
            lock[key] = request[key]
    if "migrationOrder" in request:
        lock["migrationOrder"] = request["migrationOrder"]
    return repo, changes


def build_tree(app, base, repo, changes, lock):
    with tempfile.TemporaryDirectory(prefix="maturiraj-index-") as tmp:
        index = Path(tmp) / "index"
        git(app, "read-tree", base, index=index)
        records = []
        for path, value in changes.items():
            mode, oid = value or ("0", ZERO)
            if value:
                blob = git(repo, "cat-file", "blob", oid)
                require(scalar(app, "hash-object", "-w", "--stdin", data=blob) == oid,
                        f"Blob hash mismatch: {path}")
            records.append(f"{mode} {oid}\t{path}\0")
        contents = (json.dumps(lock, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        oid = scalar(app, "hash-object", "-w", "--stdin", data=contents)
        records.append(f"100644 {oid}\t{LOCK}\0")
        git(app, "update-index", "-z", "--index-info", data="".join(records).encode("utf-8"), index=index)
        return scalar(app, "write-tree", index=index)


def publish_candidate(app, base, branch, candidate, new_tree, request):
    require(candidate != branch and candidate.startswith("refs/heads/"), "Use a separate candidate branch")
    git(app, "check-ref-format", candidate)
    existing = scalar(app, "for-each-ref", "--format=%(refname) %(objectname)", candidate)
    if existing:
        ref, oid = existing.split()
        require(ref == candidate and scalar(app, "show", "-s", "--format=%P %T", oid) == f"{base} {new_tree}",
                "Candidate already exists with a different parent or tree")
        return oid
    message = f"Integrate {request['module']} at {request['commit']}\n"
    oid = scalar(app, "commit-tree", new_tree, "-p", base, data=message.encode())
    # Git checks the input branch tip and creates the output ref under the same ref transaction.
    clean_base(app, base)
    transaction = f"start\nverify {branch} {base}\ncreate {candidate} {oid}\nprepare\ncommit\n"
    git(app, "update-ref", "--stdin", data=transaction.encode())
    return oid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repos", required=True, type=Path, help="Parent of the local source repositories")
    parser.add_argument("--base", required=True, type=sha, help="Expected HEAD of the clean app worktree")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--checkout", type=Path, help="Create a new detached worktree from the locked composition")
    mode.add_argument("--request", type=Path, help="Import only the source paths named in this JSON file")
    parser.add_argument("--candidate", help="New local branch for the integration commit")
    args = parser.parse_args()
    app = Path.cwd().resolve()
    require(app == Path(scalar(app, "rev-parse", "--show-toplevel")).resolve(), "Run at the app worktree root")
    clean_base(app, args.base)
    manifest, lock = (parse_json(git(app, "show", f"{args.base}:{p}")) for p in (OWNERSHIP, LOCK))
    require(manifest["version"] == lock["version"] == 1, "Unsupported manifest version")
    repos = args.repos.resolve()
    ownership = map_owners(manifest)
    actual, originals = load_composition(repos, app, args.base, ownership, lock)
    check_order(lock["migrationOrder"], actual)
    if args.checkout:
        require(not args.candidate and not os.path.lexists(args.checkout), "Checkout requires a new directory")
        git(app, "worktree", "add", "--detach", str(args.checkout.resolve()), args.base)
        print(args.base)
        return
    require(args.candidate, "--request requires --candidate")
    branch = scalar(app, "symbolic-ref", "HEAD")
    request = parse_json(args.request.read_bytes())
    repo, changes = prepare_request(repos, ownership, originals, lock, request)
    check_local_targets(app, changes, actual)
    paths = {p for p in actual if p not in changes} | {p for p, v in changes.items() if v}
    namespace(paths)
    check_order(lock["migrationOrder"], paths)
    new_tree = build_tree(app, args.base, repo, changes, lock)
    print(publish_candidate(app, args.base, branch, f"refs/heads/{args.candidate}", new_tree, request))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError) as error:
        sys.exit(f"compose: {error}")
