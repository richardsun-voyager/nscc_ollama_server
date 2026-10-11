const state = {
  token: sessionStorage.getItem("ollamaWebToken") || "",
  models: [],
  messages: [],
  attachments: [],
  busy: false,
  conversations: JSON.parse(localStorage.getItem("ollamaDeskConversations") || "[]"),
  currentId: null,
};

const el = Object.fromEntries([
  "modelSelect", "modelMeta", "activeModel", "statusDot", "connectionLabel", "connectionDetail",
  "newChatButton", "historyList", "chatScroll", "welcome", "messages", "chatForm", "promptInput",
  "sendButton", "fileInput", "attachmentTray", "settingsButton", "settingsDialog", "tokenInput",
  "saveTokenButton", "toast", "sidebar", "menuButton",
].map((id) => [id, document.getElementById(id)]));

function authHeaders(extra = {}) {
  return state.token ? { ...extra, Authorization: `Bearer ${state.token}` } : extra;
}

function humanSize(bytes) {
  if (!bytes) return "size unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const rank = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** rank).toFixed(rank > 2 ? 1 : 0)} ${units[rank]}`;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { el.toast.hidden = true; }, 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders(options.headers || {}) });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).detail || message; } catch {}
    if (response.status === 401) el.settingsDialog.showModal();
    throw new Error(message);
  }
  return response;
}

async function loadModels() {
  el.connectionLabel.textContent = "Checking Ollama";
  el.statusDot.className = "status-dot";
  try {
    const payload = await (await api("/api/models")).json();
    state.models = payload.models;
    el.modelSelect.innerHTML = "";
    if (!state.models.length) {
      el.modelSelect.add(new Option("No downloaded models", ""));
      el.modelMeta.textContent = "Run: ollama pull <model>";
    } else {
      state.models.forEach((model) => el.modelSelect.add(new Option(model.name, model.name)));
      const remembered = localStorage.getItem("ollamaDeskModel");
      if (remembered && state.models.some((model) => model.name === remembered)) el.modelSelect.value = remembered;
      updateModelDisplay();
    }
    el.connectionLabel.textContent = "Ollama connected";
    el.connectionDetail.textContent = `${state.models.length} local model${state.models.length === 1 ? "" : "s"}`;
    el.statusDot.className = "status-dot online";
  } catch (error) {
    el.modelSelect.innerHTML = '<option value="">Ollama unavailable</option>';
    el.modelMeta.textContent = "Check the server and reconnect";
    el.connectionLabel.textContent = "Connection unavailable";
    el.connectionDetail.textContent = error.message;
    el.statusDot.className = "status-dot offline";
    showToast(error.message);
  }
}

function updateModelDisplay() {
  const model = state.models.find((item) => item.name === el.modelSelect.value);
  el.activeModel.textContent = model?.name || "No model selected";
  el.modelMeta.textContent = model ? `${model.details?.parameter_size || "Local model"} · ${humanSize(model.size)}` : "Choose a model";
  if (model) localStorage.setItem("ollamaDeskModel", model.name);
}

function renderHistory() {
  el.historyList.innerHTML = "";
  if (!state.conversations.length) {
    el.historyList.innerHTML = '<p class="empty-history">Your chats stay in this browser and will appear here.</p>';
    return;
  }
  state.conversations.slice(0, 20).forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${conversation.id === state.currentId ? " active" : ""}`;
    button.textContent = conversation.title;
    button.onclick = () => loadConversation(conversation.id);
    el.historyList.append(button);
  });
}

function saveConversation() {
  if (!state.messages.length) return;
  if (!state.currentId) state.currentId = crypto.randomUUID();
  const visible = state.messages.filter((message) => message.role !== "system");
  const first = visible.find((message) => message.role === "user")?.displayContent || "New conversation";
  const record = {
    id: state.currentId,
    title: first.slice(0, 48),
    model: el.modelSelect.value,
    updatedAt: Date.now(),
    messages: state.messages.map(({ role, content, displayContent, attachmentNames }) => ({
      role,
      content: role === "user" ? (displayContent ?? content) : content,
      displayContent,
      attachmentNames,
    })),
  };
  state.conversations = [record, ...state.conversations.filter((item) => item.id !== record.id)].slice(0, 50);
  try {
    localStorage.setItem("ollamaDeskConversations", JSON.stringify(state.conversations));
  } catch {
    state.conversations = state.conversations.slice(0, 10);
    try { localStorage.setItem("ollamaDeskConversations", JSON.stringify(state.conversations)); } catch {}
    showToast("Browser storage is full; older chat history was trimmed.");
  }
  renderHistory();
}

function loadConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation || state.busy) return;
  state.currentId = id;
  state.messages = conversation.messages;
  if (state.models.some((model) => model.name === conversation.model)) {
    el.modelSelect.value = conversation.model;
    updateModelDisplay();
  }
  renderMessages();
  renderHistory();
  el.sidebar.classList.remove("open");
}

function newConversation() {
  if (state.busy) return;
  state.currentId = null;
  state.messages = [];
  state.attachments = [];
  renderMessages();
  renderAttachments();
  renderHistory();
  el.promptInput.focus();
  el.sidebar.classList.remove("open");
}

function renderText(container, text) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach((part) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = part.slice(3, -3).replace(/^\w+\n/, "");
      pre.append(code);
      container.append(pre);
    } else if (part) {
      const paragraph = document.createElement("p");
      paragraph.textContent = part;
      container.append(paragraph);
    }
  });
}

function renderMessages(streaming = false) {
  const visible = state.messages.filter((message) => message.role !== "system");
  el.welcome.hidden = visible.length > 0;
  el.messages.classList.toggle("active", visible.length > 0);
  el.messages.innerHTML = "";
  visible.forEach((message, index) => {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "assistant" ? "O" : "YOU";
    const body = document.createElement("div");
    body.className = "message-body";
    if (message.attachmentNames?.length) {
      const labels = document.createElement("div");
      labels.className = "attachment-labels";
      message.attachmentNames.forEach((name) => {
        const tag = document.createElement("span");
        tag.textContent = name;
        labels.append(tag);
      });
      body.append(labels);
    }
    renderText(body, message.displayContent ?? message.content);
    if (streaming && index === visible.length - 1) body.classList.add("typing-cursor");
    article.append(avatar, body);
    el.messages.append(article);
  });
  el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
}

function renderAttachments() {
  el.attachmentTray.hidden = !state.attachments.length;
  el.attachmentTray.innerHTML = "";
  state.attachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const icon = document.createElement("b");
    icon.textContent = attachment.kind === "image" ? "IMG" : "DOC";
    const name = document.createElement("span");
    name.textContent = attachment.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.ariaLabel = `Remove ${attachment.name}`;
    remove.onclick = () => { state.attachments.splice(index, 1); renderAttachments(); };
    chip.append(icon, name, remove);
    el.attachmentTray.append(chip);
  });
}

async function addFiles(files) {
  for (const file of files) {
    const kind = file.type.startsWith("image/") ? "image" : "document";
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await (await api(`/api/files/${kind}`, { method: "POST", body })).json();
      state.attachments.push({ kind, ...result });
      renderAttachments();
    } catch (error) {
      showToast(`${file.name}: ${error.message}`);
    }
  }
  el.fileInput.value = "";
}

async function sendMessage() {
  const prompt = el.promptInput.value.trim();
  const model = el.modelSelect.value;
  if ((!prompt && !state.attachments.length) || state.busy) return;
  if (!model) return showToast("Select a downloaded Ollama model first.");

  const documents = state.attachments.filter((item) => item.kind === "document");
  const images = state.attachments.filter((item) => item.kind === "image");
  const documentContext = documents.map((doc) => `\n\n--- Attached document: ${doc.name} ---\n${doc.text}\n--- End document ---`).join("");
  const displayContent = prompt || (images.length ? "Please analyze the attached image." : "Please review the attached document.");
  const userMessage = {
    role: "user",
    content: `${displayContent}${documentContext}`,
    displayContent,
    images: images.map((image) => image.data),
    attachmentNames: state.attachments.map((item) => item.name),
  };
  state.messages.push(userMessage);
  state.attachments = [];
  el.promptInput.value = "";
  el.promptInput.style.height = "auto";
  renderAttachments();
  state.messages.push({ role: "assistant", content: "", displayContent: "" });
  state.busy = true;
  el.sendButton.disabled = true;
  renderMessages(true);

  const payloadMessages = state.messages.slice(0, -1).map(({ role, content, images: messageImages }) => ({
    role,
    content,
    ...(messageImages?.length ? { images: messageImages } : {}),
  }));

  try {
    const response = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: payloadMessages }),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        const chunk = event.message?.content || "";
        const target = state.messages[state.messages.length - 1];
        target.content += chunk;
        target.displayContent += chunk;
        renderMessages(true);
      }
      if (done) break;
    }
  } catch (error) {
    const target = state.messages[state.messages.length - 1];
    target.content = `Sorry, the request failed: ${error.message}`;
    target.displayContent = target.content;
    showToast(error.message);
  } finally {
    state.busy = false;
    el.sendButton.disabled = false;
    renderMessages(false);
    saveConversation();
  }
}

el.modelSelect.addEventListener("change", updateModelDisplay);
el.newChatButton.addEventListener("click", newConversation);
el.chatForm.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(); });
el.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
});
el.promptInput.addEventListener("input", () => {
  el.promptInput.style.height = "auto";
  el.promptInput.style.height = `${Math.min(el.promptInput.scrollHeight, 170)}px`;
});
el.fileInput.addEventListener("change", () => addFiles([...el.fileInput.files]));
el.settingsButton.addEventListener("click", () => { el.tokenInput.value = state.token; el.settingsDialog.showModal(); });
el.saveTokenButton.addEventListener("click", (event) => {
  event.preventDefault();
  state.token = el.tokenInput.value.trim();
  sessionStorage.setItem("ollamaWebToken", state.token);
  el.settingsDialog.close();
  loadModels();
});
el.menuButton.addEventListener("click", () => el.sidebar.classList.toggle("open"));
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => { el.promptInput.value = button.dataset.prompt; el.promptInput.focus(); });
});

renderHistory();
renderMessages();
loadModels();
