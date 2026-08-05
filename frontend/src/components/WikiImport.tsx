import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import Spinner from '@atlaskit/spinner'
import TextField from '@atlaskit/textfield'
import { Field, HelperMessage } from '@atlaskit/form'
import { ApiError } from '../api/client'
import { useImportJob, useRunImport, useStartConfluenceImport } from '../api/hooks'
import { t } from '../i18n'

// Confluence space importer, riding the Stage-6 import-job pipeline:
// credentials → scan (dry-run report) → run → done.
export function ImportSpaceModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [spaceKey, setSpaceKey] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [jobId, setJobId] = useState<string | undefined>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const start = useStartConfluenceImport()
  const run = useRunImport()
  const { data: job } = useImportJob(jobId)

  const begin = () => {
    setErrors({})
    start.mutate(
      { site: site.trim(), email: email.trim(), apiToken: apiToken.trim(), spaceKey: spaceKey.trim(), targetKey: targetKey.trim() || undefined },
      {
        onSuccess: (j) => setJobId(j.id),
        onError: (e) => setErrors(e instanceof ApiError ? e.body.errors : { site: e.message }),
      },
    )
  }

  const stats = job?.stats as { phase?: string; progress?: string; counts?: Record<string, number>; errors?: string[] } | undefined
  const destKey = (targetKey.trim() || spaceKey.trim()).toUpperCase()

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="medium">
        <ModalHeader>
          <ModalTitle>{t('Import from Confluence')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {!jobId && (
            <>
              <p style={{ fontSize: 13, marginTop: 0 }}>
                {t('Bring a Confluence Cloud space into DocHat: pages, hierarchy, folders, whiteboards, tables, panels, action items, inline images, and attachments.')}
              </p>
              <Field name="site" label={t('Site URL')} isRequired>
                {() => (
                  <>
                    <TextField value={site} onChange={(e) => setSite((e.target as HTMLInputElement).value)} placeholder="https://your-team.atlassian.net" />
                    {errors.site && <HelperMessage>{errors.site}</HelperMessage>}
                  </>
                )}
              </Field>
              <Field name="email" label={t('Account email')} isRequired>
                {() => (
                  <>
                    <TextField value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} />
                    {errors.email && <HelperMessage>{errors.email}</HelperMessage>}
                  </>
                )}
              </Field>
              <Field name="apiToken" label={t('API token')} isRequired>
                {() => (
                  <>
                    <TextField type="password" value={apiToken} onChange={(e) => setApiToken((e.target as HTMLInputElement).value)} />
                    {errors.apiToken ? <HelperMessage>{errors.apiToken}</HelperMessage> : <HelperMessage>{t('Create one at id.atlassian.com → Security → API tokens')}</HelperMessage>}
                  </>
                )}
              </Field>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Field name="spaceKey" label={t('Confluence space key')} isRequired>
                    {() => (
                      <>
                        <TextField value={spaceKey} onChange={(e) => setSpaceKey((e.target as HTMLInputElement).value.toUpperCase())} placeholder="ENG" />
                        {errors.spaceKey && <HelperMessage>{errors.spaceKey}</HelperMessage>}
                      </>
                    )}
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field name="targetKey" label={t('DocHat space key (optional)')}>
                    {() => (
                      <TextField value={targetKey} onChange={(e) => setTargetKey((e.target as HTMLInputElement).value.toUpperCase())} placeholder={spaceKey || 'ENG'} />
                    )}
                  </Field>
                </div>
              </div>
            </>
          )}

          {jobId && job && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {(job.status === 'scanning' || job.status === 'running' || job.status === 'created') && <Spinner size="small" />}
                <Lozenge appearance={job.status === 'done' ? 'success' : job.status === 'failed' ? 'removed' : 'inprogress'}>
                  {job.status}
                </Lozenge>
                {stats?.progress && <span style={{ fontSize: 13 }}>{stats.progress}</span>}
              </div>

              {job.status === 'scanned' && (
                <SectionMessage appearance="discovery" title={t('Ready to import')}>
                  <p>
                    {t('{n} pages found in {key}.', { n: stats?.counts?.pages ?? 0, key: spaceKey })}{' '}
                    {stats?.counts?.attachments ? t('{n} attachments will be imported.', { n: stats.counts.attachments }) : ''}
                  </p>
                  {(stats?.errors ?? []).map((e, i) => (
                    <p key={i} style={{ fontSize: 12 }}>{e}</p>
                  ))}
                </SectionMessage>
              )}
              {job.status === 'done' && (
                <SectionMessage appearance="success" title={t('Import complete')}>
                  <p>
                    {t('{n} pages created, {m} updated.', { n: stats?.counts?.pages ?? 0, m: stats?.counts?.updated ?? 0 })}{' '}
                    {stats?.counts?.attachments ? t('{n} attachments imported.', { n: stats.counts.attachments }) : ''}
                  </p>
                </SectionMessage>
              )}
              {job.status === 'failed' && (
                <SectionMessage appearance="error" title={t('Import failed')}>
                  <p>{job.error}</p>
                </SectionMessage>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{job?.status === 'done' ? t('Close') : t('Cancel')}</Button>
          {!jobId && (
            <Button appearance="primary" isLoading={start.isPending} onClick={begin}>
              {t('Connect and scan')}
            </Button>
          )}
          {job?.status === 'scanned' && (
            <Button appearance="primary" isLoading={run.isPending} onClick={() => run.mutate(job.id)}>
              {t('Import {n} pages', { n: stats?.counts?.pages ?? 0 })}
            </Button>
          )}
          {job?.status === 'failed' && (
            <Button appearance="primary" onClick={() => setJobId(undefined)}>{t('Back')}</Button>
          )}
          {job?.status === 'done' && (
            <Button appearance="primary" onClick={() => { onClose(); navigate(`/wiki/spaces/${destKey}`) }}>
              {t('View space')}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}
