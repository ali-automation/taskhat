import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import Form, { ErrorMessage, Field, HelperMessage } from '@atlaskit/form'
import Select from '@atlaskit/select'
import { useCreateProject } from '../api/hooks'
import { ApiError } from '../api/client'
import { t } from '../i18n'

// Auto-suggest a key from the name the way Jira does (initials, max 10).
function suggestKey(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const initials = words.map((w) => w[0]).join('')
  const key = (initials.length >= 2 ? initials : words[0].slice(0, 4)).replace(/[^A-Z0-9]/g, '')
  return key.slice(0, 10)
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

const typeOptions = [
  { label: t('Kanban'), value: 'kanban' },
  { label: t('Scrum'), value: 'scrum' },
]

export default function CreateProjectModal({ isOpen, onClose }: Props) {
  const createProject = useCreateProject()
  const navigate = useNavigate()
  const [keyTouched, setKeyTouched] = useState(false)

  const onSubmit = async (values: { name: string; key: string; projectType: { value: string } | null }) => {
    try {
      const project = await createProject.mutateAsync({
        name: values.name.trim(),
        key: values.key.trim().toUpperCase(),
        projectType: values.projectType?.value ?? 'kanban',
      })
      onClose()
      navigate(`/projects/${project.key}/issues`)
      return undefined
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.body.errors).length > 0) return err.body.errors
      return { name: err instanceof Error ? err.message : t('something went wrong') }
    }
  }

  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="small">
          <Form<{ name: string; key: string; projectType: { value: string } | null }> onSubmit={onSubmit}>
            {({ formProps, submitting, setFieldValue }) => (
              <form {...formProps}>
                <ModalHeader>
                  <ModalTitle>{t('Create project')}</ModalTitle>
                </ModalHeader>
                <ModalBody>
                  <Field name="name" label={t('Name')} isRequired defaultValue="">
                    {({ fieldProps, error }) => (
                      <>
                        <TextField
                          {...fieldProps}
                          placeholder={t('e.g. Payment platform')}
                          onChange={(e) => {
                            fieldProps.onChange(e)
                            if (!keyTouched) setFieldValue('key', suggestKey(e.currentTarget.value))
                          }}
                          autoFocus
                        />
                        {error && <ErrorMessage>{error}</ErrorMessage>}
                      </>
                    )}
                  </Field>
                  <Field name="key" label={t('Key')} isRequired defaultValue="">
                    {({ fieldProps, error }) => (
                      <>
                        <TextField
                          {...fieldProps}
                          placeholder={t('e.g. PAY')}
                          onChange={(e) => {
                            setKeyTouched(true)
                            fieldProps.onChange(e)
                          }}
                        />
                        <HelperMessage>{t('Issue keys will look like KEY-123. Cannot be changed later.')}</HelperMessage>
                        {error && <ErrorMessage>{error}</ErrorMessage>}
                      </>
                    )}
                  </Field>
                  <Field<{ label: string; value: string } | null>
                    name="projectType"
                    label={t('Template')}
                    defaultValue={typeOptions[0]}
                  >
                    {({ fieldProps }) => <Select {...fieldProps} options={typeOptions} />}
                  </Field>
                </ModalBody>
                <ModalFooter>
                  <Button appearance="subtle" onClick={onClose}>
                    {t('Cancel')}
                  </Button>
                  <Button type="submit" appearance="primary" isLoading={submitting}>
                    {t('Create')}
                  </Button>
                </ModalFooter>
              </form>
            )}
          </Form>
        </Modal>
      )}
    </ModalTransition>
  )
}
