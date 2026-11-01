// Aktobly website: fills in release data, copy buttons, OS hint and the hero demo.
(function () {
  "use strict";
  var R = window.AKTOBLY_RELEASE || { version: "0.1.0", files: [], repoUrl: "" };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var byKind = {};
  (R.files || []).forEach(function (f) { byKind[f.kind] = f; });

  // ---- release data ----
  var mb = function (b) { return (b / 1048576).toFixed(1) + " MB"; };
  $$("[data-version]").forEach(function (el) { el.textContent = R.version; });
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
  $$("[data-date]").forEach(function (el) {
    if (!R.date) return;
    var d = new Date(R.date + "T00:00:00");
    el.textContent = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  });
  $$("[data-dl]").forEach(function (a) {
    var f = byKind[a.getAttribute("data-dl")];
    if (!f) return;
    // Hero/CTA buttons scroll to the download section first so people see setup steps.
    if (a.getAttribute("href") !== "#download") {
      a.href = f.url;
      a.setAttribute("download", f.file);
    }
  });
  $$("[data-size]").forEach(function (el) {
    var f = byKind[el.getAttribute("data-size")];
    if (f) el.textContent = mb(f.bytes);
  });
  $$("[data-sha]").forEach(function (el) {
    var f = byKind[el.getAttribute("data-sha")];
    if (f) { el.textContent = f.sha256; el.title = f.sha256; }
  });
  $$("[data-file]").forEach(function (el) {
    var f = byKind[el.getAttribute("data-file")];
    if (f) el.textContent = f.file;
  });
  if (R.repoUrl) {
    $$("[data-repo]").forEach(function (a) { a.href = R.repoUrl; a.hidden = false; });
    $$("[data-repo-issues]").forEach(function (a) { a.href = R.repoUrl.replace(/\/$/, "") + "/issues"; a.hidden = false; });
  }

  // ---- copy buttons ----
  function copy(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("ok");
      setTimeout(function () { btn.textContent = old; btn.classList.remove("ok"); }, 1400);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    } else { fallback(text); done(); }
  }
  function fallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () { copy(b.parentElement.querySelector("code").textContent.trim(), b); });
  });
  $$("[data-copy-sha]").forEach(function (b) {
    b.addEventListener("click", function () {
      var f = byKind[b.getAttribute("data-copy-sha")];
      if (f) copy(f.sha256, b);
    });
  });

  // ---- non-Windows visitors ----
  var ua = navigator.userAgent || "";
  if (!/Windows/i.test(ua)) {
    var note = document.getElementById("os-note");
    if (note) note.classList.add("show");
  }

  // ---- hero demo ----
  var input = document.getElementById("demo-input");
  var output = document.getElementById("demo-output");
  if (!input || !output) return;
  var gen = document.getElementById("demo-gen");
  var copyEl = document.getElementById("demo-copy");
  var lang = document.getElementById("demo-lang");
  var tone = document.getElementById("demo-tone");
  var subject = document.getElementById("mail-subject");

  var scenes = [
    {
      draft: "hey wanted to ask if you guys have any cloud engineer jobs available im a new grad thanks",
      lang: "Arabic — Saudi Professional", tone: "Professional", rtl: true,
      subject: "طلب وظيفة مهندس حوسبة سحابية",
      out: "الموضوع: طلب وظيفة مهندس حوسبة سحابية\n\nالسلام عليكم ورحمة الله،\n\nأتمنى أن تكونوا بخير. أودّ أن أسألكم عن توفر وظائف مهندس حوسبة سحابية في الشركة. أنا حديث التخرج، ويسعدني أن أكون جزءًا من فريقكم.\n\nشاكر ومقدّر تفهمكم.\n\nتحياتي،",
    },
    {
      draft: "yo just checking if theres any update on the meeting",
      lang: "English — Professional", tone: "Polite", rtl: false,
      subject: "Update on Meeting",
      out: "Subject: Update on Meeting\n\nHello,\n\nI was just checking if there were any updates regarding our meeting. Could you please let me know if anything has changed or if we are still scheduled as planned?\n\nThank you for your time.\n\nBest regards,",
    },
  ];

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function showFinal(s) {
    input.textContent = s.draft;
    lang.textContent = s.lang; tone.textContent = s.tone;
    output.setAttribute("dir", s.rtl ? "rtl" : "ltr");
    output.textContent = s.out;
    subject.textContent = s.subject;
  }

  if (reduce) { showFinal(scenes[0]); return; }

  // Pause the loop while the demo is off-screen.
  var visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(input);
  }
  var whenVisible = function () {
    return new Promise(function (r) { (function check() { visible ? r() : setTimeout(check, 400); })(); });
  };

  async function play(s) {
    await whenVisible();
    lang.textContent = s.lang; tone.textContent = s.tone;
    output.textContent = ""; output.className = "p-output";
    output.setAttribute("dir", s.rtl ? "rtl" : "ltr");
    copyEl.textContent = "Copy"; copyEl.classList.remove("done");
    subject.innerHTML = "&nbsp;";
    input.innerHTML = '<span class="ph">Write anything, in any language...</span>';
    await wait(900);
    input.textContent = ""; input.classList.add("caret");
    for (var i = 0; i < s.draft.length; i++) {
      input.textContent += s.draft[i];
      await wait(28 + Math.random() * 40);
    }
    input.classList.remove("caret");
    await wait(450);
    gen.classList.add("pressed"); await wait(180); gen.classList.remove("pressed");
    await wait(500);
    // Stream word by word, like the real app.
    var words = s.out.split(/(\s+)/);
    output.classList.add("caret");
    for (var w = 0; w < words.length; w++) {
      output.textContent += words[w];
      await wait(words[w].trim() ? 45 + Math.random() * 45 : 0);
    }
    output.classList.remove("caret");
    await wait(700);
    copyEl.textContent = "✓ Copied"; copyEl.classList.add("done");
    await wait(500);
    subject.textContent = s.subject;
    await wait(3200);
  }

  (async function loop() {
    for (var n = 0; ; n = (n + 1) % scenes.length) await play(scenes[n]);
  })();
})();
