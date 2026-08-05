import TextField from '@atlaskit/textfield'
import Select from '@atlaskit/select'
import type { CustomField } from '../api/types'
import { t } from '../i18n'

// Input widget for one custom field value (create modal + issue details).
export default function CustomFieldInput({
  field,
  value,
  onChange,
  isCompact,
}: {
  field: CustomField
  value: unknown
  onChange: (v: unknown) => void
  isCompact?: boolean
}) {
  switch (field.type) {
    case 'number':
      return (
        <TextField
          isCompact={isCompact}
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            const raw = (e.target as HTMLInputElement).value
            onChange(raw === '' ? null : Number(raw))
          }}
          placeholder="—"
        />
      )
    case 'date':
      return (
        <TextField
          isCompact={isCompact}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange((e.target as HTMLInputElement).value || null)}
        />
      )
    case 'select': {
      const options = field.options.map((o) => ({ label: o, value: o }))
      return (
        <Select
          spacing={isCompact ? 'compact' : 'default'}
          options={options}
          isClearable
          placeholder={t('Select…')}
          value={typeof value === 'string' && value !== '' ? { label: value, value } : null}
          onChange={(o) => onChange(o?.value ?? null)}
        />
      )
    }
    default:
      return (
        <TextField
          isCompact={isCompact}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder="—"
        />
      )
  }
}
