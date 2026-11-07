/* Körkortsfrågor — quiz över den sammanslagna frågebanken i data/questions.json */

// Samma ordning som kategorierna byggs i build.py; "Blandat" sist.
const CATEGORIES = ["Bilen", "Stadskörning", "Landsvägskörning", "Olyckor",
                    "Mörker & Halka", "Människan", "Miljö", "Vägmärken", "Blandat"];

const EXAM_LENGTH = 65;       // Trafikverkets prov: 65 frågor som räknas,
const EXAM_PASS = 52;         // varav 52 rätt krävs för godkänt (80 %).
const PRACTICE_LENGTH = 25;
const PASS_RATIO = EXAM_PASS / EXAM_LENGTH;

const el = (id) => document.getElementById(id);
const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Kör om en CSS-animation på ett element som redan finns i DOM:en. */
function replay(node, className) {
  if (!node || calmMotion.matches) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}
const screens = {
  start: el("screen-start"),
  quiz: el("screen-quiz"),
  result: el("screen-result"),
};

let bank = [];
let session = null;

/* ---------- hjälpfunktioner ---------- */

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  el("abort").hidden = name !== "quiz";
  window.scrollTo(0, 0);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  return min ? `${min} min ${total % 60} s` : `${total} s`;
}

/* ---------- sparad statistik ---------- */

const store = {
  read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem("korkort." + key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem("korkort." + key, JSON.stringify(value));
    } catch { /* privat läge eller full kvot — statistiken är inte kritisk */ }
  },
};

const stats = {
  get: () => store.read("stats", { answered: 0, correct: 0, quizzes: 0 }),
  mistakes: () => store.read("mistakes", []),
  record(question, wasCorrect) {
    const s = stats.get();
    s.answered++;
    if (wasCorrect) s.correct++;
    store.write("stats", s);

    const missed = new Set(stats.mistakes());
    if (wasCorrect) missed.delete(question.id);
    else missed.add(question.id);
    store.write("mistakes", [...missed].slice(-300));
    reminders.notePractice();
  },
  finishQuiz() {
    const s = stats.get();
    s.quizzes++;
    store.write("stats", s);
  },
  reset() {
    store.write("stats", { answered: 0, correct: 0, quizzes: 0 });
    store.write("mistakes", []);
  },
};

/* ---------- daglig påminnelse (Web Push) ---------- */

const today = () => new Date().toLocaleDateString("sv-SE");   // YYYY-MM-DD, lokal tid

const reminders = {
  supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
  // iOS ger bara push till appar som lagts till på hemskärmen; i Safari saknas PushManager.
  ios: /iPhone|iPad|iPod/.test(navigator.userAgent) ||
       (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  key: null,
  busy: false,
  error: "",

  saved: () => store.read("reminder", null),        // { time: "18:00" } när påslagen

  async api(path, method, body) {
    const response = await fetch("/api/push/" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      throw new Error(error || `HTTP ${response.status}`);
    }
    return response.status === 200 ? response.json() : null;
  },

  async serverKey() {
    if (!this.key) {
      const { publicKey } = await this.api("key", "GET");
      const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
      this.key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    }
    return this.key;
  },

  async subscription() {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  },

  async put(subscription, time, confirm = false) {
    await this.api("subscription", "PUT", {
      subscription, time, confirm,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  },

  async enable() {
    const time = el("reminder-time").value || "18:00";
    // Frågan om lov måste komma direkt från klicket, innan något annat väntas in.
    if (await Notification.requestPermission() !== "granted") return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: await this.serverKey(),
    });
    await this.put(subscription, time, true);
    store.write("reminder", { time });
    store.write("practiced", null);
  },

  async disable() {
    store.write("reminder", null);
    const subscription = await this.subscription();
    if (!subscription) return;
    await this.api("subscription", "DELETE", { endpoint: subscription.endpoint }).catch(() => {});
    await subscription.unsubscribe();
  },

  async changeTime(time) {
    const subscription = await this.subscription();
    if (!this.saved() || !subscription) return;
    await this.put(subscription, time);
    store.write("reminder", { time });
  },

  /** Vid start: stäm av mot webbläsaren och håll serverns kopia aktuell. */
  async sync() {
    if (!this.supported) return;
    const subscription = await this.subscription();
    const saved = this.saved();
    if (!subscription || Notification.permission !== "granted") {
      if (saved) store.write("reminder", null);    // återkallad i webbläsaren
    } else if (saved) {
      // Har servern bytt nycklar duger den gamla prenumerationen inte längre.
      const key = new Uint8Array(subscription.options.applicationServerKey || []);
      const current = await this.serverKey();
      if (key.length && key.join() !== current.join()) {
        await subscription.unsubscribe();
        store.write("reminder", null);
        this.error = "Påminnelserna behöver slås på igen.";
      } else {
        await this.put(subscription, saved.time);
      }
    }
    this.render();
  },

  /** Den som övar i dag ska inte få dagens påminnelse. */
  notePractice() {
    if (!this.saved() || store.read("practiced") === today()) return;
    store.write("practiced", today());
    this.subscription()
      .then((s) => s && this.api("practiced", "POST", { endpoint: s.endpoint }))
      .catch(() => store.write("practiced", null));
  },

  async run(action) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.render();
    try {
      await action();
    } catch (error) {
      this.error = `Det gick inte: ${error.message}`;
    } finally {
      this.busy = false;
      this.render();
    }
  },

  render() {
    const box = el("reminder");
    const text = el("reminder-text");
    const controls = el("reminder-controls");
    text.classList.remove("bad");

    if (!this.supported) {
      box.hidden = !this.ios;
      controls.hidden = true;
      text.textContent = "Lägg till appen på hemskärmen för att kunna få påminnelser: " +
        "tryck på Dela och välj Lägg till på hemskärmen.";
      return;
    }
    box.hidden = false;

    if (Notification.permission === "denied") {
      controls.hidden = true;
      text.classList.add("bad");
      text.textContent = "Notiser är blockerade för sidan. Tillåt dem i webbläsarens " +
        "inställningar för att kunna få påminnelser.";
      return;
    }
    controls.hidden = false;

    const saved = this.saved();
    if (saved) el("reminder-time").value = saved.time;
    text.classList.toggle("bad", Boolean(this.error));
    text.textContent = this.error || (saved
      ? `Du får en notis kl. ${saved.time} de dagar du inte har övat.`
      : "Få en notis de dagar du inte har övat, vid den tid du väljer.");

    const toggle = el("reminder-toggle");
    toggle.textContent = saved ? "Stäng av" : "Slå på";
    toggle.className = saved ? "ghost" : "primary";
    toggle.disabled = this.busy;
  },
};

el("reminder-toggle").addEventListener("click", () =>
  reminders.run(() => (reminders.saved() ? reminders.disable() : reminders.enable())));
el("reminder-time").addEventListener("change", (event) => {
  if (event.target.value) reminders.run(() => reminders.changeTime(event.target.value));
});

/* ---------- startsidan ---------- */

function renderStart() {
  el("stat-total").textContent = bank.length;

  const counts = new Map(CATEGORIES.map((c) => [c, 0]));
  for (const q of bank) counts.set(q.category, (counts.get(q.category) || 0) + 1);

  const list = el("category-list");
  list.replaceChildren();
  for (const [category, count] of counts) {
    if (!count) continue;
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.start = "category";
    chip.dataset.category = category;
    chip.append(category);
    const n = document.createElement("span");
    n.textContent = count;
    chip.append(n);
    list.append(chip);
  }

  const missed = stats.mistakes();
  el("card-mistakes").hidden = missed.length < 5;
  el("mistakes-count").textContent = missed.length;

  const s = stats.get();
  el("stats-box").hidden = s.answered === 0;
  if (s.answered) {
    const pct = Math.round((s.correct / s.answered) * 100);
    el("stats-text").textContent =
      `${plural(s.quizzes, "avklarat test", "avklarade test")} · ` +
      `${s.correct} rätt av ${s.answered} besvarade frågor (${pct} %).`;
  }

  reminders.render();
}

/* ---------- en omgång ---------- */

function pick(pool, n) {
  return shuffle(pool).slice(0, n).map((q) => ({
    question: q,
    order: shuffle(q.options.map((_, i) => i)),
    picked: null,
  }));
}

function startSession(mode, category) {
  let items, title;
  if (mode === "exam") {
    items = pick(bank, EXAM_LENGTH);
    title = "Provet";
  } else if (mode === "category") {
    items = pick(bank.filter((q) => q.category === category), PRACTICE_LENGTH);
    title = category;
  } else if (mode === "mistakes") {
    const missed = new Set(stats.mistakes());
    items = pick(bank.filter((q) => missed.has(q.id)), PRACTICE_LENGTH);
    title = "Repetera misstag";
  } else {
    items = pick(bank, PRACTICE_LENGTH);
    title = "Snabbtest";
  }

  if (!items.length) return;                       // inget kvar att öva på

  session = {
    mode, title, items, index: 0,
    instant: mode !== "exam",       // provet rättas först på slutet
    startedAt: Date.now(),
    counted: new Set(),             // frågor redan inräknade i statistiken
  };
  show("quiz");
  renderQuestion();
}

function currentItem() {
  return session.items[session.index];
}

function renderQuestion(justAnswered = false) {
  const item = currentItem();
  const q = item.question;
  const answered = item.picked !== null;
  const reveal = session.instant && answered;

  const done = session.index + (answered ? 1 : 0);
  const progress = (done / session.items.length) * 100;
  el("progress-fill").style.width = `${progress}%`;
  el("progress-car").style.left = `${progress}%`;
  el("progress-label").textContent =
    `${session.title} · fråga ${session.index + 1} av ${session.items.length}`;
  el("score-label").textContent = session.instant
    ? `${session.items.filter((i) => i.picked === i.question.answer).length} rätt`
    : "";

  el("q-category").textContent = q.category;
  el("q-text").textContent = q.question;

  if (!answered) replay(document.querySelector(".question"), "enter");

  const media = el("q-media");
  media.replaceChildren();
  if (q.video) {
    const video = document.createElement("video");
    video.src = "media/" + q.video;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    media.append(video);
  } else if (q.image) {
    const img = document.createElement("img");
    img.src = "media/" + q.image;
    img.alt = "Bild till frågan";
    img.loading = "lazy";
    media.append(img);
  }

  const options = el("q-options");
  options.replaceChildren();
  options.classList.toggle("locked", reveal);
  item.order.forEach((optionIndex, position) => {
    const button = document.createElement("button");
    button.className = "option";
    button.type = "button";
    button.dataset.option = optionIndex;
    if (item.picked === optionIndex && !reveal) button.classList.add("picked");
    if (reveal) {
      if (optionIndex === q.answer) button.classList.add("correct");
      else if (item.picked === optionIndex) button.classList.add("wrong");
      if (justAnswered && (optionIndex === q.answer || item.picked === optionIndex)) {
        button.classList.add(optionIndex === q.answer ? "pop" : "shake");
      }
    }
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = position + 1;
    const text = document.createElement("span");
    text.textContent = q.options[optionIndex];
    button.append(key, text);
    options.append(button);
  });

  const explanation = el("q-explanation");
  explanation.hidden = !reveal;
  if (reveal) {
    explanation.replaceChildren(explanationNodes(q, item.picked === q.answer));
  }

  el("btn-prev").hidden = session.instant || session.index === 0;
  const next = el("btn-next");
  next.disabled = !answered;
  next.textContent = session.index === session.items.length - 1 ? "Avsluta" : "Nästa";
}

function explanationNodes(q, wasCorrect) {
  const wrap = document.createDocumentFragment();
  const heading = document.createElement("p");
  heading.className = `heading ${wasCorrect ? "ok" : "bad"}`;
  heading.textContent = wasCorrect
    ? "Rätt svar!"
    : `Fel — rätt svar är: ${q.options[q.answer]}`;
  wrap.append(heading);
  for (const paragraph of q.explanation) {
    const p = document.createElement("p");
    p.textContent = paragraph;
    wrap.append(p);
  }
  return wrap;
}

function answer(optionIndex) {
  const item = currentItem();
  if (session.instant && item.picked !== null) return;   // låst efter rättning
  item.picked = optionIndex;
  if (navigator.vibrate && session.instant) {
    navigator.vibrate(optionIndex === item.question.answer ? 15 : [15, 60, 15]);
  }
  if (session.instant) {
    // Svaret låses vid rättning, så det kan bokföras direkt. I provläget kan
    // svaret ändras ända till slutet och bokförs därför först i finish().
    session.counted.add(item.question.id);
    stats.record(item.question, optionIndex === item.question.answer);
  }
  renderQuestion(true);
}

function step(delta) {
  const next = session.index + delta;
  if (next < 0) return;
  if (next >= session.items.length) return finish();
  session.index = next;
  renderQuestion();
}

/* ---------- resultat ---------- */

function finish() {
  const items = session.items;
  for (const item of items) {
    if (item.picked !== null && !session.counted.has(item.question.id)) {
      session.counted.add(item.question.id);
      stats.record(item.question, item.picked === item.question.answer);
    }
  }
  stats.finishQuiz();
  const correct = items.filter((i) => i.picked === i.question.answer).length;
  const passed = correct / items.length >= PASS_RATIO;

  const verdict = el("verdict");
  verdict.className = `verdict ${passed ? "pass" : "fail"}`;
  const score = document.createElement("div");
  score.className = "score";
  score.textContent = `${correct} / ${items.length}`;
  countUp(score, correct, items.length);
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = passed ? "Godkänt" : "Underkänt";
  verdict.replaceChildren(score, label);

  const needed = Math.ceil(items.length * PASS_RATIO);
  el("result-summary").textContent =
    `${session.title} · ${formatDuration(Date.now() - session.startedAt)} · ` +
    `${needed} rätt krävs för godkänt.`;

  const review = el("review");
  review.replaceChildren();
  items.forEach((item, i) => {
    const q = item.question;
    const wasCorrect = item.picked === q.answer;
    const details = document.createElement("details");
    details.className = `review-item ${wasCorrect ? "right" : "wrong"}`;
    details.open = !wasCorrect;

    const summary = document.createElement("summary");
    summary.textContent = `${i + 1}. ${q.question}`;
    details.append(summary);

    const body = document.createElement("div");
    body.className = "review-body";
    if (q.video) {
      const video = document.createElement("video");
      video.src = "media/" + q.video;
      video.controls = true;
      video.playsInline = true;
      video.preload = "none";
      body.append(video);
    } else if (q.image) {
      const img = document.createElement("img");
      img.src = "media/" + q.image;
      img.alt = "Bild till frågan";
      img.loading = "lazy";
      body.append(img);
    }

    const given = document.createElement("p");
    given.className = `review-answer ${wasCorrect ? "ok" : "bad"}`;
    given.textContent = item.picked === null
      ? "Obesvarad"
      : `Ditt svar: ${q.options[item.picked]}`;
    body.append(given);

    if (!wasCorrect) {
      const right = document.createElement("p");
      right.className = "review-answer ok";
      right.textContent = `Rätt svar: ${q.options[q.answer]}`;
      body.append(right);
    }

    const explanation = document.createElement("div");
    explanation.className = "explanation";
    for (const paragraph of q.explanation) {
      const p = document.createElement("p");
      p.textContent = paragraph;
      explanation.append(p);
    }
    body.append(explanation);
    details.append(body);
    review.append(details);
  });

  show("result");
  if (passed) celebrate();
}

/** Räknar upp resultatsiffran i stället för att bara slänga upp den. */
function countUp(node, correct, total) {
  if (calmMotion.matches || correct === 0) return;
  const steps = Math.min(correct, 25);
  let shown = 0;
  const timer = setInterval(() => {
    shown = Math.min(correct, shown + Math.ceil(correct / steps));
    node.textContent = `${shown} / ${total}`;
    if (shown >= correct) clearInterval(timer);
  }, 40);
  node.textContent = `0 / ${total}`;
}

/** Konfetti vid godkänt prov — liten canvas, inget bibliotek. */
function celebrate() {
  const canvas = el("confetti");
  if (calmMotion.matches || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth, height = canvas.offsetHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);

  const colors = ["#1c6dd0", "#5a9dfb", "#17803d", "#6ede9a", "#f5c542", "#ff8a8a"];
  const bits = Array.from({ length: 90 }, () => ({
    x: width / 2 + (Math.random() - 0.5) * width * 0.6,
    y: height * 0.55 + Math.random() * 40,
    vx: (Math.random() - 0.5) * 6,
    vy: -6 - Math.random() * 7,
    size: 4 + Math.random() * 5,
    spin: (Math.random() - 0.5) * 0.3,
    angle: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  let frame = 0;
  (function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const bit of bits) {
      bit.vy += 0.22;                       // tyngdkraft
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.angle += bit.spin;
      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.angle);
      ctx.fillStyle = bit.color;
      ctx.globalAlpha = Math.max(0, 1 - frame / 130);
      ctx.fillRect(-bit.size / 2, -bit.size / 2, bit.size, bit.size * 0.6);
      ctx.restore();
    }
    if (++frame < 130) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, width, height);
  })();
}

/* ---------- händelser ---------- */

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-start], [data-action], .option");
  if (!trigger) return;

  if (trigger.dataset.start) {
    event.preventDefault();
    startSession(trigger.dataset.start, trigger.dataset.category);
  } else if (trigger.dataset.action === "home") {
    event.preventDefault();
    session = null;
    renderStart();
    show("start");
  } else if (trigger.dataset.action === "again") {
    const { mode, title } = session;
    startSession(mode, mode === "category" ? title : undefined);
  } else if (trigger.dataset.action === "reset-stats") {
    stats.reset();
    renderStart();
  } else if (trigger.classList.contains("option") && session) {
    answer(Number(trigger.dataset.option));
  }
});

el("btn-next").addEventListener("click", () => step(1));
el("btn-prev").addEventListener("click", () => step(-1));

document.addEventListener("keydown", (event) => {
  if (screens.quiz.hidden || event.metaKey || event.ctrlKey || event.altKey) return;
  const item = currentItem();
  if (/^[1-9]$/.test(event.key)) {
    const position = Number(event.key) - 1;
    if (position < item.order.length) {
      event.preventDefault();
      answer(item.order[position]);
    }
  } else if (event.key === "Enter" && item.picked !== null) {
    event.preventDefault();
    step(1);
  }
});

/* ---------- start ---------- */

fetch("data/questions.json")
  .then((r) => r.json())
  .then((data) => {
    bank = data;
    renderStart();
    // Genvägarna i app-manifestet: /?start=exam
    const shortcut = new URLSearchParams(location.search).get("start");
    if (["exam", "quick", "mistakes"].includes(shortcut)) {
      history.replaceState(null, "", location.pathname);
      startSession(shortcut);
    }
  })
  .catch(() => {
    el("stat-total").textContent = "—";
    el("category-list").textContent = "Kunde inte läsa in frågorna. Ladda om sidan.";
  });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
    reminders.sync().catch(() => {});     // påminnelsetjänsten är inte kritisk för resten
  });
}
