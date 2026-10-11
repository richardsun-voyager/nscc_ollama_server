# NSCC Ollama Desk

A private, browser-based chat interface for an Ollama installation on an NSCC node. It discovers models from the local Ollama service, streams chat responses, accepts images for vision-capable models, and extracts text from PDF, DOCX, and text-based documents.

## Quick start on NSCC

The commands below assume Ollama is already installed and your shell is on the compute node where Ollama will run.

```bash
git clone <this-repository-url>
cd nscc_ollama_server

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
ollama serve
```

In a second shell on the same node:

```bash
source .venv/bin/activate
./run.sh
```

If `ollama serve` reports that the port is already in use, Ollama is probably already running. Confirm with:

```bash
curl http://127.0.0.1:11434/api/tags
```

## Connect remotely (recommended)

Keep `APP_HOST=127.0.0.1`. From your laptop, forward a local port through the NSCC login host to the node running the app:

```bash
ssh -N -L 9955:COMPUTE_NODE:9955 YOUR_USER@NSCC_LOGIN_HOST
```

Then open [http://127.0.0.1:9955](http://127.0.0.1:9955). Replace `COMPUTE_NODE`, `YOUR_USER`, and `NSCC_LOGIN_HOST` with the values for your allocation. If NSCC requires a jump host or an active scheduler allocation, follow the centre's current SSH tunnelling guidance.

### Direct network exposure

SSH forwarding is safer because the web service remains on loopback. If your NSCC environment requires binding to the node network, set a strong token and bind explicitly:

```bash
APP_HOST=0.0.0.0
OLLAMA_WEB_TOKEN=<a-long-random-secret>
```

The browser's settings button accepts the same token. Use an HTTPS reverse proxy when traffic leaves a trusted network; the app itself does not terminate TLS.

## Models and attachments

- Download models with `ollama pull MODEL_NAME`; refresh the page to update the selector.
- Images are sent through Ollama's `images` chat field. Choose a vision-capable model such as one of your locally installed multimodal models.
- PDF, DOCX, Markdown, code, CSV, JSON, logs, and plain-text files are converted to text and added to the user message as context.
- Uploads are processed in memory and are not saved on the server. Conversation history is stored only in the browser's local storage; image payloads and extracted document contents are deliberately not retained there. Reattach a file after reloading an old conversation if the model still needs it as context.
- Default limits are 25 MB per upload and 200,000 extracted characters per document. Adjust `MAX_UPLOAD_MB` and `MAX_DOCUMENT_CHARS` in `.env` if needed.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API address |
| `APP_HOST` | `127.0.0.1` | Web server bind address |
| `APP_PORT` | `9955` | Web server port |
| `OLLAMA_WEB_TOKEN` | empty | Optional bearer token required by API routes |
| `MAX_UPLOAD_MB` | `25` | Maximum size per uploaded file |
| `MAX_DOCUMENT_CHARS` | `200000` | Maximum extracted text per document |

## Health checks

```bash
curl http://127.0.0.1:9955/api/config
curl http://127.0.0.1:9955/api/health
```

When token protection is enabled, add `-H "Authorization: Bearer $OLLAMA_WEB_TOKEN"` to protected API checks.

## Tests

The test suite uses a simulated Ollama response, so it does not need a running model:

```bash
source .venv/bin/activate
python -m unittest discover -s tests -v
```
