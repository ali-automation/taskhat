import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import Form, { ErrorMessage, Field } from '@atlaskit/form'
import Select, { CreatableSelect } from '@atlaskit/select'
import Avatar from '@atlaskit/avatar'
import { useCreateIssue, useProjectFields, useProjects, useUserSearch, useWorkTypes } from '../api/hooks'
import { ApiError } from '../api/client'
import { IssueTypeIcon, PriorityIcon, priorityLabel } from './icons'
import { RichTextEditor } from './RichText'
import CustomFieldInput from './CustomFieldInput'
import type { Priority } from '../api/types'
import { t } from '../i18n'

interface Props {
  isOpen: boolean
  onClose: () => void
  defaultProjectKey?: string
}

interface Option {
  label: string
  value: string
}


const priorityOptions = (['highest', 'high', 'medium', 'low', 'lowest'] as Priority[]).map((p) => ({
  label: priorityLabel[p],
  value: p,
}))

interface FormValues {
  project: Option | null
  issuetype: Option | null
  summary: string
  description: string
  priority: Option | null
  assignee: Option | null
  labels: readonly Option[]
}

export default function CreateIssueModal({ isOpen, onClose, defaultProjectKey }: Props) {
  const { data: projects } = useProjects()
  const { data: users } = useUserSearch('')
  const { data: workTypes } = useWorkTypes()
  const createIssue = useCreateIssue()
  const navigate = useNavigate()
  const [createAnother, setCreateAnother] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [selectedProject, setSelectedProject] = useState<string | undefined>(undefined)
  const [custom, setCustom] = useState<Record<string, unknown>>({})
  const [descr, setDescr] = useState<{ doc: unknown; text: string } | null>(null)

  // Work types come from the site registry (custom types included).
  const typeOptions = useMemo(
    () => (workTypes ?? []).filter((t) => t.key !== 'subtask').map((t) => ({ label: t.name, value: t.key })),
    [workTypes],
  )
  const defaultType = typeOptions.find((o) => o.value === 'task') ?? typeOptions[0] ?? { label: t('Task'), value: 'task' }

  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key })),
    [projects],
  )
  const defaultProject = projectOptions.find((o) => o.value === defaultProjectKey) ?? projectOptions[0] ?? null
  const activeProjectKey = selectedProject ?? defaultProject?.value
  const { data: projectFields } = useProjectFields(isOpen ? activeProjectKey : undefined)

  const userOptions = useMemo(
    () => (users ?? []).map((u) => ({ label: u.displayName, value: u.id })),
    [users],
  )

  const onSubmit = async (values: FormValues) => {
    if (!values.project) return { project: t('select a project') }
    try {
      const issue = await createIssue.mutateAsync({
        project: { key: values.project.value },
        issuetype: { name: values.issuetype?.value ?? 'task' },
        summary: values.summary,
        descriptionDoc: descr?.text.trim() ? descr.doc : undefined,
        priority: { name: values.priority?.value ?? 'medium' },
        assignee: values.assignee ? { id: values.assignee.value } : undefined,
        labels: values.labels.map((l) => l.value),
        custom: Object.keys(custom).length > 0 ? custom : undefined,
      })
      setCustom({})
      setDescr(null)
      if (createAnother) {
        setFormKey((k) => k + 1) // reset the form, keep the modal open
      } else {
        onClose()
        navigate(`/browse/${issue.key}`)
      }
      return undefined
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.body.errors).length > 0) return err.body.errors
      return { summary: err instanceof Error ? err.message : t('something went wrong') }
    }
  }

  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="medium" shouldScrollInViewport>
          <Form<FormValues> key={formKey} onSubmit={onSubmit}>
            {({ formProps, submitting }) => (
              <form {...formProps}>
                <ModalHeader>
                  <ModalTitle>{t('Create')}</ModalTitle>
                </ModalHeader>
                <ModalBody>
                  <p style={{ fontSize: 12, color: '#626F86', marginBottom: 4 }}>
                    {t('Required fields are marked with an asterisk')} <span style={{ color: '#AE2E24' }}>*</span>
                  </p>
                  <Field<Option | null> name="project" label={t('Space')} isRequired defaultValue={defaultProject}>
                    {({ fieldProps, error }) => (
                      <>
                        <Select<Option>
                          {...fieldProps}
                          options={projectOptions}
                          placeholder={t('Select project')}
                          onChange={(v) => {
                            fieldProps.onChange(v)
                            setSelectedProject(v?.value)
                            setCustom({})
                          }}
                        />
                        {error && <ErrorMessage>{error}</ErrorMessage>}
                      </>
                    )}
                  </Field>
                  <Field<Option | null> name="issuetype" label={t('Work type')} isRequired defaultValue={defaultType}>
                    {({ fieldProps }) => (
                      <Select<Option>
                        {...fieldProps}
                        options={typeOptions}
                        formatOptionLabel={(o) => (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <IssueTypeIcon type={o.value} />
                            {o.label}
                          </span>
                        )}
                      />
                    )}
                  </Field>
                  <div style={{ margin: '14px 0 2px', paddingTop: 12, borderTop: '1px solid #DFE1E6' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#626F86', marginBottom: 4 }}>{t('Status')}</div>
                    <span
                      style={{
                        display: 'inline-block',
                        background: '#F1F2F4',
                        borderRadius: 4,
                        padding: '4px 10px',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {t('To Do')} ⌄
                    </span>
                    <div style={{ fontSize: 12, color: '#626F86', marginTop: 4 }}>
                      {t('This is the initial status upon creation')}
                    </div>
                  </div>
                  <Field name="summary" label={t('Summary')} isRequired defaultValue="">
                    {({ fieldProps, error }) => (
                      <>
                        <TextField {...fieldProps} placeholder={t('What needs to be done?')} />
                        {error && <ErrorMessage>{error}</ErrorMessage>}
                      </>
                    )}
                  </Field>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#626F86', marginBottom: 4 }}>{t('Description')}</div>
                    <RichTextEditor
                      key={formKey}
                      placeholder={t('Add a description…')}
                      onChange={(doc, text) => setDescr({ doc, text })}
                    />
                  </div>
                  <Field<Option | null> name="assignee" label={t('Assignee')} defaultValue={null}>
                    {({ fieldProps }) => (
                      <Select<Option>
                        {...fieldProps}
                        options={userOptions}
                        isClearable
                        placeholder={t('Automatic (unassigned)')}
                        formatOptionLabel={(o) => (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Avatar size="xsmall" name={o.label} />
                            {o.label}
                          </span>
                        )}
                      />
                    )}
                  </Field>
                  <Field<Option | null> name="priority" label={t('Priority')} defaultValue={priorityOptions[2]}>
                    {({ fieldProps }) => (
                      <Select<Option>
                        {...fieldProps}
                        options={priorityOptions}
                        formatOptionLabel={(o) => (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <PriorityIcon priority={o.value as Priority} />
                            {o.label}
                          </span>
                        )}
                      />
                    )}
                  </Field>
                  <Field<readonly Option[]> name="labels" label={t('Labels')} defaultValue={[]}>
                    {({ fieldProps }) => (
                      <CreatableSelect<Option, true>
                        {...fieldProps}
                        isMulti
                        options={[]}
                        placeholder={t('Type to add labels')}
                        formatCreateLabel={(input: string) => t('Add "{input}"', { input })}
                      />
                    )}
                  </Field>
                  {(projectFields ?? []).map((f) => (
                    <div key={f.id} style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#626F86', marginBottom: 4 }}>{f.name}</div>
                      <CustomFieldInput field={f} value={custom[f.id]} onChange={(v) => setCustom({ ...custom, [f.id]: v })} />
                    </div>
                  ))}
                </ModalBody>
                <ModalFooter>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginInlineEnd: 'auto', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={createAnother} onChange={(e) => setCreateAnother(e.currentTarget.checked)} />
                    {t('Create another')}
                  </label>
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
