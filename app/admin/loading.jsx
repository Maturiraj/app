import styles from './AdminOverview.module.css'

export default function AdminLoading() {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.loadingMark} aria-hidden="true" />
      Učitavanje administratorskog pregleda…
    </div>
  )
}
