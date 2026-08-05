import { useAuth } from '../auth/AuthContext'
import { t } from '../i18n'

export default function YourWorkPage() {
  const { user } = useAuth()
  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>{t('Your work')}</h1>
      <p>
        {t('Welcome,')} <strong>{user?.displayName}</strong>
        {t('. TaskHat Stage 0 is up — the Docker stack, authentication, and this Jira-style shell are running.')}
      </p>
      <p style={{ marginTop: 8 }}>
        {t('Stage 1 adds projects and issues: worked on, viewed, and assigned to me will appear here.')}
      </p>
    </div>
  )
}
