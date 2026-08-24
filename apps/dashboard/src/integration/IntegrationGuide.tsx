import type { Project } from "@utility-services/contracts";

import { CopyButton } from "../shared/CopyButton.js";

export function IntegrationGuide({
  project,
  apiBaseUrl,
}: {
  project: Project;
  apiBaseUrl: string;
}) {
  const snippets = [
    {
      title: "1. Authorize upload",
      value: `export API_BASE_URL="${apiBaseUrl}"
export RUS_API_KEY="paste-the-key-shown-once"

curl --fail-with-body -X POST "$API_BASE_URL/v1/files/uploads" \\
  -H "Authorization: Bearer $RUS_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data '{"name":"example.pdf","mediaType":"application/pdf","sizeBytes":12345,"visibility":"private"}'`,
    },
    {
      title: "2. Upload directly",
      value: `# Read data.upload.url and data.upload.requiredHeaders from the response.
# Send bytes directly to that opaque temporary S3 URL; they never pass through this API.
curl --fail-with-body -X PUT "$UPLOAD_URL" \\
  -H "Content-Type: application/pdf" -H "Content-Length: 12345" \\
  -H 'If-None-Match: *' --data-binary @example.pdf`,
    },
    {
      title: "3. List and inspect",
      value: `# Poll a pending upload until its metadata becomes ready.
curl --fail-with-body "$API_BASE_URL/v1/files?limit=20" -H "Authorization: Bearer $RUS_API_KEY"
curl --fail-with-body "$API_BASE_URL/v1/files/$FILE_ID" -H "Authorization: Bearer $RUS_API_KEY"`,
    },
    {
      title: "4. Authorize private download",
      value: `curl --fail-with-body -X POST "$API_BASE_URL/v1/files/$FILE_ID/downloads" \\
  -H "Authorization: Bearer $RUS_API_KEY"

# Give only data.download.url to the client. It downloads directly from S3.
curl --fail-with-body "$DOWNLOAD_URL" --output downloaded-file`,
    },
    {
      title: "5. Public access and lifecycle",
      value: `# A public file's stable service URL redirects to a fresh temporary S3 URL.
curl --fail-with-body "$API_BASE_URL/files/public/$PUBLIC_PROJECT_ID/$PUBLIC_FILE_ID"

# Trash for 14 days, or restore while preserving identity.
curl --fail-with-body -X DELETE "$API_BASE_URL/v1/files/$FILE_ID" -H "Authorization: Bearer $RUS_API_KEY"
curl --fail-with-body -X POST "$API_BASE_URL/v1/files/$FILE_ID/restore" -H "Authorization: Bearer $RUS_API_KEY"

# Irreversible: permanently delete immediately only when you intend to.
curl --fail-with-body -X DELETE "$API_BASE_URL/v1/files/$FILE_ID?force=true" -H "Authorization: Bearer $RUS_API_KEY"`,
    },
  ];

  return (
    <section
      className="panel experience-panel integration-guide"
      aria-labelledby="integration-title"
    >
      <p className="eyebrow">Five-minute integration</p>
      <h2 id="integration-title">Generate transfer URLs on your server</h2>
      <p>
        Your project API key authenticates server-to-server File Management requests. The service
        derives project access, quotas, and usage from that key. Your client receives only
        short-lived presigned URLs.
      </p>
      <ol>
        <li>Create and store a project API key in your server&apos;s secret manager.</li>
        <li>Request an upload authorization from your server.</li>
        <li>Let the client upload directly to S3 with the returned URL and exact headers.</li>
        <li>For downloads, request a fresh URL and pass only that URL to the client.</li>
      </ol>
      <p className="field-note">
        Upload URLs expire after {project.fileManagement.uploadUrlLifetimeMinutes} minutes; download
        URLs expire after {project.fileManagement.downloadUrlLifetimeMinutes} minutes. Request a
        fresh URL after expiry and never log a presigned URL&apos;s query string.
      </p>
      {snippets.map((snippet) => (
        <div className="code-sample" key={snippet.title}>
          <div className="section-heading">
            <h3>{snippet.title}</h3>
            <CopyButton value={snippet.value} label="Copy curl" />
          </div>
          <pre>
            <code>{snippet.value}</code>
          </pre>
        </div>
      ))}
      <p className="field-note">
        These curl examples are the canonical server-side path. Browser cross-origin fetch to S3
        also requires an explicitly approved bucket CORS origin policy; presigning does not bypass
        browser CORS. File visibility cannot be changed after creation.
      </p>
    </section>
  );
}
