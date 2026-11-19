import styles from './AdminOverview.module.css'

export default function AdminLoading({ label = 'Učitavanje administratorskog pregleda…' }) {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.loadingMark} aria-hidden="true" />
      {label}
    </div>
  )
}
