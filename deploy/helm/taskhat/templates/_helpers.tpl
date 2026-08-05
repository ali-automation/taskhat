{{/* Chart name */}}
{{- define "taskhat.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* Fully qualified release name */}}
{{- define "taskhat.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* Common labels */}}
{{- define "taskhat.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 }}
app.kubernetes.io/name: {{ include "taskhat.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels for one component. Usage:
     {{ include "taskhat.selectorLabels" (dict "root" . "component" "api") }} */}}
{{- define "taskhat.selectorLabels" -}}
app.kubernetes.io/name: {{ include "taskhat.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* Image reference. Usage:
     {{ include "taskhat.image" (dict "root" . "img" .Values.image.api) }} */}}
{{- define "taskhat.image" -}}
{{- $tag := default .root.Chart.AppVersion .img.tag -}}
{{- if .root.Values.image.registry -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .img.repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .img.repository $tag -}}
{{- end -}}
{{- end }}

{{/* Name of the Secret holding credentials */}}
{{- define "taskhat.secretName" -}}
{{- default (include "taskhat.fullname" .) .Values.auth.existingSecret -}}
{{- end }}

{{/* Connection URLs (only rendered into the chart-managed Secret) */}}
{{- define "taskhat.dbUrl" -}}
{{- if .Values.postgresql.enabled -}}
{{- $pass := required "postgresql.auth.password is required when postgresql.enabled=true (or set auth.existingSecret)" .Values.postgresql.auth.password -}}
{{- printf "postgres://%s:%s@%s-postgresql:5432/%s?sslmode=disable" .Values.postgresql.auth.username $pass (include "taskhat.fullname" .) .Values.postgresql.auth.database -}}
{{- else -}}
{{- required "externalDatabase.url is required when postgresql.enabled=false" .Values.externalDatabase.url -}}
{{- end -}}
{{- end }}

{{- define "taskhat.redisUrl" -}}
{{- if .Values.redis.enabled -}}
{{- printf "redis://%s-redis:6379/0" (include "taskhat.fullname" .) -}}
{{- else -}}
{{- required "externalRedis.url is required when redis.enabled=false" .Values.externalRedis.url -}}
{{- end -}}
{{- end }}

{{- define "taskhat.amqpUrl" -}}
{{- if .Values.rabbitmq.enabled -}}
{{- $pass := required "rabbitmq.auth.password is required when rabbitmq.enabled=true (or set auth.existingSecret)" .Values.rabbitmq.auth.password -}}
{{- printf "amqp://%s:%s@%s-rabbitmq:5672/" .Values.rabbitmq.auth.username $pass (include "taskhat.fullname" .) -}}
{{- else -}}
{{- required "externalAmqp.url is required when rabbitmq.enabled=false" .Values.externalAmqp.url -}}
{{- end -}}
{{- end }}

{{/* Pod security context for the distroless Go binaries (nonroot 65532) */}}
{{- define "taskhat.backendSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
runAsUser: 65532
runAsGroup: 65532
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/* Environment shared by api, worker and the migrate initContainer.

     Two layers, both overridable:
       1. Secret-backed refs (DB/AMQP/JWT/S3 keys/SMTP password) from the
          chart Secret.
       2. Plain vars derived from the config and s3 convenience values.
     Anything in .Values.env (a plain NAME: value map) wins over both — an
     env: entry suppresses the generated one of the same name, so ANY
     backend variable can be set or overridden directly in values.yaml or
     a cluster values file. */}}
{{- define "taskhat.backendEnv" -}}
{{- $userEnv := .Values.env | default dict -}}
{{- $userSecrets := .Values.secrets | default dict -}}
{{- $secretName := include "taskhat.secretName" . -}}
{{- $secretRefs := dict
      "TASKHAT_DB_URL" "db-url"
      "TASKHAT_REDIS_URL" "redis-url"
      "TASKHAT_AMQP_URL" "amqp-url"
      "TASKHAT_JWT_SECRET" "jwt-secret" -}}
{{- if .Values.config.smtpPassword }}
{{- $_ := set $secretRefs "TASKHAT_SMTP_PASSWORD" "smtp-password" }}
{{- end }}
{{- if .Values.s3.enabled }}
{{- $_ := set $secretRefs "S3_ACCESS_KEY_ID" "s3-access-key-id" }}
{{- $_ := set $secretRefs "S3_SECRET_ACCESS_KEY" "s3-secret-access-key" }}
{{- end }}
{{- range $name, $key := $secretRefs }}
{{- if not (or (hasKey $userEnv $name) (hasKey $userSecrets $name)) }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $secretName }}
      key: {{ $key }}
{{- end }}
{{- end }}
{{- $env := dict
      "TASKHAT_BASE_URL" .Values.config.baseUrl
      "TASKHAT_ENV" .Values.config.env
      "TASKHAT_STORAGE_DIR" "/data/attachments"
      "TASKHAT_SMTP_ADDR" .Values.config.smtpAddr
      "TASKHAT_SMTP_FROM" .Values.config.smtpFrom
      "TASKHAT_SMTP_USERNAME" .Values.config.smtpUsername -}}
{{- if .Values.s3.enabled }}
{{- $_ := set $env "S3_ENDPOINT_URL" .Values.s3.endpointUrl }}
{{- $_ := set $env "S3_REGION" .Values.s3.region }}
{{- $_ := set $env "S3_BUCKET" .Values.s3.bucket }}
{{- $_ := set $env "S3_PREFIX" .Values.s3.prefix }}
{{- end }}
{{- $env = mergeOverwrite $env (deepCopy $userEnv) }}
{{- /* a name in secrets: must reach the pod via envFrom — drop the derived
       plain entry (unless env: explicitly overrides, which wins anyway) */}}
{{- range $name, $_ := $userSecrets }}
{{- if not (hasKey $userEnv $name) }}
{{- $env = unset $env $name }}
{{- end }}
{{- end }}
{{- range $name, $value := $env }}
- name: {{ $name }}
  value: {{ $value | toString | quote }}
{{- end }}
{{- end }}

{{/* Attachments volume + mount, shared by api and worker when S3 is off */}}
{{- define "taskhat.attachmentsVolume" -}}
{{- if not .Values.s3.enabled }}
- name: attachments
  {{- if .Values.attachments.persistence.enabled }}
  persistentVolumeClaim:
    claimName: {{ default (printf "%s-attachments" (include "taskhat.fullname" .)) .Values.attachments.persistence.existingClaim }}
  {{- else }}
  emptyDir: {}
  {{- end }}
{{- end }}
{{- end }}

{{- define "taskhat.attachmentsMount" -}}
{{- if not .Values.s3.enabled }}
- name: attachments
  mountPath: /data/attachments
{{- end }}
{{- end }}

{{- define "taskhat.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "taskhat.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end }}

{{- define "taskhat.imagePullSecrets" -}}
{{- with .Values.image.pullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}
