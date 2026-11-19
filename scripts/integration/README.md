# Lokalni sastav aplikacije

Naredbe se pokreću iz korijena čistog izdvojenog worktreeja repozitorija `app`, uz Git, Python 3.9+ i lokalne izvorne repozitorije. Primjeri koriste PowerShell. Zadržite lokalnu granu ili oznaku za svaku predanu reviziju kako bi njezini objekti ostali dostupni.

## Prvi sastav

Orkestrator otvara integracijsku granu u novom worktreeju od zaključane aplikacijske baze. U varijablu `$predaja` upisuje puni SHA predaje naloga 1. Prenosi taj commit odjednom.

```powershell
$repoRoot = 'C:/Users/PC/Desktop/Maturiraj'
$izdanje = "$repoRoot/.worktrees/integracija"
$baza = '0d2bb0d3be7b37f99e18130b8d4906dbda3b8e5f'
git -C "$repoRoot/app" worktree add -b plan/v1-integracija $izdanje $baza
Set-Location -LiteralPath $izdanje
git cherry-pick -x $predaja
git rev-parse HEAD
```

U evidenciju u `agent-ops` unosi se dobiveni integracijski SHA uz roditelja `$baza` i SHA predaje. Početni sastav koristi postojeće integrirane datoteke iz aplikacijske baze. Vlasništvo i revizije svih 25 repozitorija zapisani su u istom commitu.

## Radna kopija iz zaključanih revizija

```powershell
$baza = git rev-parse HEAD
python scripts/integration/compose.py --repos $repoRoot --base $baza --checkout "$repoRoot/.worktrees/razvoj-02"
```

Alat čita zaključane objekte iz lokalnih repozitorija i uspoređuje sadržaj i Git način svake uvozne datoteke sa sastavom. Potom iz tog integracijskog commita otvara novu radnu kopiju. Za razvoj uz pripremljene ovisnosti i lokalni Supabase koristi se `npm run dev`. Već evidentirani integracijski SHA dovoljan je za običan Git checkout i izgradnju cjelovite aplikacije bez susjednih repozitorija.

## Predaja odabranih putanja jednog modula

Orkestrator u JSON datoteku **izvan worktreeja** upisuje modul, njegov puni lokalni commit i točne ulazne putanje odobrene nalogom. Primjer za dodanu taksonomiju slijedi u nastavku. Zamijenite oznaku stvarnim SHA.

```json
{
  "module": "sadrzaj",
  "commit": "<puni SHA predaje u repozitoriju sadrzaj>",
  "paths": ["content/discere/bio/taxonomy.json"],
  "delete": []
}
```

```powershell
$baza = git rev-parse HEAD
$zahtjev = "$repoRoot/.worktrees/predaja-02.json"
python scripts/integration/compose.py --repos $repoRoot --base $baza --request $zahtjev --candidate plan/kandidat-02
```

Nakon uspješnog završetka, iz istog čistog worktreeja na istom prethodnom vrhu:

```powershell
git merge --ff-only --no-overwrite-ignore plan/kandidat-02
git rev-parse HEAD
```

U operativnu evidenciju upišite novi SHA samo ako je njezin posljednji evidentirani sastav još `$baza`. Kandidat sadrži jedan commit sa svim odabranim datotekama i novim lockom. Ulazi dolaze iz Git objekata, uključujući kada je izvor druga grana samog repozitorija `app`. Neovisne grane mogu imati promjene drugih datoteka koje nisu dio predaje.

## Vlasništvo i revizije

- `ownership.json` grupira putanje po vlasniku. U `identityPaths` svaka upisana putanja istodobno je ulazna i ciljna. Za različita imena koristi se `mappings` s objektima `{"source":"stara/putanja","target":"nova/putanja"}`. Orkestrator u sastavu evidentira novog vlasnika i novu putanju prije dodjele. Tri unaprijed upisane putanje za naloge 2 i 5 mogu nedostajati u početnom stablu.
- `localOnly` navodi izuzeće za pojedinu ulaznu putanju i razlog. README-i, operaterski materijali, sigurnosne i privremene kopije ostaju u svom izvornom kontekstu. Zatečene aplikacijske kopije čuva bazni Git commit. Kod dviju kopija zajedničke specifikacije AI potrošnje prenosi se primjerak vlasnika `ai-profesor`. Zapis `reference:ai-profesor` upućuje drugi modul na zaključanu reviziju vlasnika.
- Dvije aktivne mape s istim ciljem blokiraju sastav čak i kada su datoteke jednake. Različit sadržaj na ciljnoj putanji od zaključanog prethodnog objekta također ga blokira. Orkestrator razrješava vlasništvo prije nove predaje. Putanje su relativne prema korijenu odgovarajućeg Git stabla, s kosom crtom. Alat odbija nepodržane načine datoteka na odabranim putanjama, prolaz kroz vezu i imena koja bi se preklopila na Windowsu.
- `modules.lock.json` bilježi početni app SHA i `baseCommit` svakog modula. Samo imenovane putanje dobivaju `pathCommits` za svoj novi izvorni SHA. Brisanje se izričito predaje kroz `delete`. Putanja mora imati prethodno integrirani objekt, nedostajati u predanom izvornom commitu i još odgovarati prethodnoj reviziji u aplikaciji. Lock zadržava njezin SHA i zapis u `deleted`. Ponovno dodavanje putem `paths` uklanja taj zapis.
- Za promjenu ugovora ili audio izdanja zahtjev uz putanje može sadržavati `contractVersion` ili `audioRelease`. Početna oznaka ugovora je `plan-v1`, a audio oznaka `eng-audio-v1` potječe iz README-a zaključanog audio repozitorija. Medijske datoteke imaju zasebnu distribuciju.
- `migrationOrder` bilježi slijed SQL putanja. Početni je popis poredan po nazivima u lokalnom stablu. Svaku dodanu ili obrisanu migraciju u istom zahtjevu prati cijeli usuglašeni popis. Početno stablo sadrži dva naziva s verzijom `20260922000000`. Redoslijed primjene u konkretnoj bazi i razrješenje te dvostruke verzije pripadaju vlasniku baze prije primjene.

## Prekid i povratak

1. Zadržite zahtjev, prethodni integracijski SHA i sve izvorne SHA. Ako nedostaje Git objekt, obnovite ga iz poznate lokalne kopije ili sigurnosne kopije izvornog repoa. Kod lokalnih izmjena upotrijebite drugi čisti worktree ili ih prethodno sačuvajte.
2. Sastavljanje koristi privatni privremeni indeks. Nakon prekida prije objave kandidata označite pokušaj nedovršenim i ponovite istu naredbu na istom prethodnom vrhu. Nepovezani Git objekti iz prekinutog pokušaja ne mijenjaju radnu kopiju. Ako grana kandidata već postoji, alat prihvaća samo očekivani roditeljski commit i identično stablo, uključujući lock.
3. Ako je kandidat već promaknut, usporedite `git rev-parse HEAD`, `git rev-parse 'HEAD^'`, SHA kandidata i `git show HEAD:integration/modules.lock.json` s prethodnim zapisom i predajom. Kod podudaranja dopunite samo evidenciju. Ako je vrh u međuvremenu otišao dalje, uskladite postojeće integracije s evidencijom prije sljedećeg prijenosa.
4. Za povratak otvorite novi izdvojeni worktree ili novu granu na prethodnom evidentiranom integracijskom SHA. Taj commit već sadrži cjelovito stablo i tadašnji lock. Evidentirajte odabrani povratak, pripremite kompatibilnu migraciju ili zaseban oporavak podataka za bazu i uskladite dostupno audio izdanje s oznakom iz locka.
