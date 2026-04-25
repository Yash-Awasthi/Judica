{{/*
Expand the name of the chart.
*/}}
{{- define "aibyai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "aibyai.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "aibyai.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "aibyai.labels" -}}
helm.sh/chart: {{ include "aibyai.chart" . }}
{{ include "aibyai.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "aibyai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aibyai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend selector labels
*/}}
{{- define "aibyai.backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aibyai.name" . }}-backend
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "aibyai.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aibyai.name" . }}-frontend
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "aibyai.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "aibyai.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Backend image name
*/}}
{{- define "aibyai.backend.image" -}}
{{- printf "%s/backend:%s" .Values.image.repository .Values.image.tag }}
{{- end }}

{{/*
Frontend image name
*/}}
{{- define "aibyai.frontend.image" -}}
{{- printf "%s/frontend:%s" .Values.image.repository .Values.image.tag }}
{{- end }}
