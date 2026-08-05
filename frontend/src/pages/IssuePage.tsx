import { useParams } from 'react-router-dom'
import IssueDetail from '../components/IssueDetail'

export default function IssuePage() {
  const { issueKey } = useParams<{ issueKey: string }>()
  if (!issueKey) return null
  return <IssueDetail issueKey={issueKey} />
}
