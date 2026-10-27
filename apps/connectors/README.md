# PostOrca MCP connectors

PostOrca's execution service for Gmail and Google Drive tools, built on the Model Context Protocol (MCP). This package runs as an independent service with its own dependencies, environment, build, and process.

## Local development

From the repository root:

```sh
npm install
cp apps/connectors/.env.example apps/connectors/.env
npm run connectors:start
```

Set a random service key in `apps/connectors/.env` as `MCP_SERVER_API_KEY`. Set the matching value in PostOrca API's `.env` as `MCP_CONNECTOR_API_KEY`, with `MCP_CONNECTOR_URL=http://127.0.0.1:3100/mcp`.

Available scripts:
- `npm run connectors:dev`: Run with hot reload.
- `npm run connectors:start`: Run with tsx.
- `npm run connectors:build`: Compile TypeScript to `dist/`.
- `npm run connectors:test`: Run unit and integration tests using mocked upstream Google endpoints.

## Request flow

PostOrca's backend handles user OAuth, token encryption/storage, and refresh. When an agent tool call is dispatched:
1. The backend issues a request to `/mcp` with `Authorization: Bearer <MCP_CONNECTOR_API_KEY>` and the user's `X-Google-Access-Token`.
2. The connector service creates a fresh, stateless MCP server and transport for each HTTP request.
3. Google credentials are dynamically scoped per request using `AsyncLocalStorage`.
4. No account tokens or client secrets are persisted in this service.

Endpoints:
- `GET /health`: Liveness probe returning `{ "status": "ok" }`.
- `POST /mcp`: Authenticated MCP Streamable HTTP endpoint.

## Tools

- `gmail_read_emails`: Search and read messages with subject, from, to, date, snippet, and plain text body (supporting multipart messages).
- `gmail_send_email`: Send plain-text MIME messages with UTF-8 subject/body encoding, line wrapping, and header injection validation.
- `google_drive_list_drive_files`: Search and list files with query and parent folder filters.
- `google_drive_read_file`: Read text files (up to 10MB) or export Google Workspace documents (Docs, Sheets, Slides) as text/CSV/HTML/JSON.
- `google_drive_write_file`: Create or update text files within the connected account.
