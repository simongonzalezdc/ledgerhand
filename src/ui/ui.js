/* Ledgerhand chamber behaviors — no frameworks, no console output (console-zero gate).
 * All rendering escapes text; model-generated reasons are never trusted as markup. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---- theme toggle (aria-pressed, persisted, no flash — pre-paint in head) ---- */
  var toggle = $('themeToggle');
  function paintToggle() {
    var dark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    toggle.textContent = dark ? 'LIGHT LEDGER' : 'DARK LEDGER';
  }
  toggle.addEventListener('click', function () {
    var dark = document.documentElement.dataset.theme === 'dark';
    var next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lh-theme', next); } catch (e) { /* private mode: session-only theme */ }
    paintToggle();
  });
  paintToggle();

  /* ---- helpers ---- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function copyBtn(text, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy';
    b.setAttribute('aria-label', label || 'Copy to clipboard');
    b.textContent = 'COPY';
    b.addEventListener('click', function () {
      var done = function () {
        b.textContent = 'COPIED';
        b.classList.add('copied');
        setTimeout(function () { b.textContent = 'COPY'; b.classList.remove('copied'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) { /* older engines */ }
        document.body.removeChild(ta); done();
      }
    });
    return b;
  }
  function kvRow(dl, term, valueNode) {
    var dt = document.createElement('dt'); dt.textContent = term;
    var dd = document.createElement('dd'); dd.appendChild(valueNode);
    dl.appendChild(dt); dl.appendChild(dd);
  }
  function textNode(s) { return document.createTextNode(String(s)); }
  function hashWithCopy(value) {
    var span = document.createElement('span'); span.className = 'hash';
    span.textContent = String(value);
    span.appendChild(copyBtn(String(value), 'Copy hash'));
    return span;
  }

  /* ---- anchors status + honest offline state ---- */
  var conveneBtn = $('conveneBtn');
  function loadAnchors() {
    fetch('/api/anchors').then(function (r) { return r.json(); }).then(function (data) {
      var parts = [];
      var defOk = false;
      (data.anchors || []).forEach(function (a) {
        parts.push(a.label + ' ' + (a.ok
          ? 'LIVE ' + a.blockNumber
          : 'DEAD'));
        if (a.label === data.default && a.ok) defOk = true;
      });
      $('anchorStatus').innerHTML =
        parts.map(function (p) {
          var dead = p.indexOf('DEAD') !== -1;
          return '<span class="' + (dead ? 'dead' : 'live') + '">' + esc(p) + '</span>';
        }).join(' · ');
      $('footAnchors').textContent = 'Anchors — ' + parts.join(' · ') + ' · default ' + data.default;
      $('offlineBanner').classList.toggle('on', !defOk);
      conveneBtn.disabled = !defOk;
      conveneBtn.textContent = defOk ? 'CONVENE THE FLEET' : 'CONVENE DISABLED — ANCHOR DOWN';
    }).catch(function () {
      $('anchorStatus').textContent = 'ANCHOR PROBE FAILED — SERVER UNREACHABLE';
      $('offlineBanner').classList.add('on');
      conveneBtn.disabled = true;
    });
  }
  loadAnchors();
  setInterval(loadAnchors, 30000);

  /* ---- docket ---- */
  function loadDocket() {
    fetch('/api/receipts?limit=100').then(function (r) { return r.json(); }).then(function (data) {
      var body = $('docketBody');
      body.textContent = '';
      var rows = data.receipts || [];
      if (!rows.length) {
        var tr0 = document.createElement('tr');
        var td0 = document.createElement('td');
        td0.colSpan = 6; td0.className = 'empty';
        td0.textContent = 'NO RECEIPTS RECORDED YET';
        tr0.appendChild(td0); body.appendChild(tr0);
        return;
      }
      rows.forEach(function (rc) {
        var tr = document.createElement('tr');
        tr.className = 'row'; tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        tr.setAttribute('aria-expanded', 'false');
        tr.title = 'Open proceeding detail';
        function cell(text, cls) {
          var td = document.createElement('td');
          if (cls) td.className = cls;
          td.textContent = String(text);
          return td;
        }
        var decTd = cell(rc.decision, 'dec');
        decTd.style.color = rc.decision === 'EXECUTE' ? 'var(--verdict-execute)' : 'var(--verdict-reject)';
        tr.appendChild(cell((rc.recordedAt || '').replace('T', ' ').slice(0, 19)));
        tr.appendChild(decTd);
        tr.appendChild(cell((rc.quorum ? rc.quorum.approvals : '?') + '/' + (rc.quorum ? rc.quorum.fleetSize : '?')));
        var txTd = document.createElement('td');
        var txSpan = document.createElement('span'); txSpan.className = 'hash';
        txSpan.textContent = String(rc.txLabel || '');
        txTd.appendChild(txSpan);
        tr.appendChild(txTd);
        tr.appendChild(cell(rc.chain || ''));
        var certTd = document.createElement('td');
        certTd.appendChild(hashWithCopy(rc.certHash || ''));
        tr.appendChild(certTd);

        function toggleDetail() {
          var existing = tr.nextElementSibling;
          if (existing && existing.className === 'detail') {
            existing.remove(); tr.setAttribute('aria-expanded', 'false'); return;
          }
          var d = document.createElement('tr');
          d.className = 'detail';
          var td = document.createElement('td'); td.colSpan = 6;
          var inner = document.createElement('div'); inner.className = 'inner';
          var fact = rc.fact || {};
          inner.append(textNode('fact: ' + (fact.sourceChain || '?') + ' block ' + (fact.headerNumber || '?') +
            ' · ' + (fact.from || '?') + ' → ' + (fact.to || '?') + ' · ' +
            (Number(fact.valueWei || 0) / 1e18) + ' ETH · via ' + (fact.verifiedVia || '?')));
          inner.appendChild(document.createElement('br'));
          (rc.ballots || []).forEach(function (b) {
            inner.appendChild(textNode(' · ' + b.agentId + ' ' + b.vote + ' (' + b.confidence + ')'));
          });
          inner.appendChild(document.createElement('br'));
          inner.append(textNode('policy ' + (rc.policyId || '?')));
          td.appendChild(inner);
          d.appendChild(td);
          tr.after(d);
          tr.setAttribute('aria-expanded', 'true');
        }
        tr.addEventListener('click', toggleDetail);
        tr.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleDetail(); }
        });
        body.appendChild(tr);
      });
    });
  }
  loadDocket();

  /* ---- convene → chamber ---- */
  var form = $('conveneForm');
  var alertBox = $('formAlert');
  function refuse(msg) {
    alertBox.textContent = msg;
    alertBox.classList.add('on');
  }
  function clearRefusal() { alertBox.classList.remove('on'); }

  function renderBallots(tableBody, votes, showReasons) {
    tableBody.textContent = '';
    (votes || []).forEach(function (v) {
      var tr = document.createElement('tr');
      tr.className = 'ballot';
      var who = document.createElement('td'); who.className = 'who';
      who.append(textNode(v.agentId));
      var kind = document.createElement('span'); kind.className = 'kind';
      kind.textContent = v.agentKind;
      who.appendChild(kind);
      tr.appendChild(who);
      var vt = document.createElement('td');
      var vv = document.createElement('span'); vv.className = 'v ' + v.vote; vv.textContent = v.vote;
      vt.appendChild(vv);
      tr.appendChild(vt);
      var cf = document.createElement('td'); cf.textContent = Number(v.confidence).toFixed(2);
      tr.appendChild(cf);
      var reasons = document.createElement('td');
      if (showReasons) {
        (v.reasons || []).forEach(function (r) {
          var li = document.createElement('span'); li.className = 'why'; li.textContent = String(r);
          reasons.appendChild(li);
        });
      } else {
        reasons.textContent = 'SEALED AT CAST';
      }
      tr.appendChild(reasons);
      if (showReasons) {
        var sigTd = document.createElement('td');
        var sig = document.createElement('span'); sig.className = 'sig';
        sig.textContent = String(v.agentAddress || '');
        sigTd.appendChild(sig);
        tr.appendChild(sigTd);
      }
      tableBody.appendChild(tr);
    });
  }

  function renderProceeding(r) {
    $('chamberEmpty').hidden = true;
    $('proceeding').hidden = false;

    /* exhibit */
    var kv = $('exhibitKv'); kv.textContent = '';
    var f = r.fact;
    kvRow(kv, 'Transaction', hashWithCopy(f.txHash));
    kvRow(kv, 'Source', textNode(f.sourceChain + ' (chainKey ' + f.chainKey + ') block ' + f.block + (f.head != null ? ' @ head ' + f.head : '')));
    kvRow(kv, 'Parties', textNode(f.from + ' → ' + f.to));
    kvRow(kv, 'Value', textNode(f.valueEth + ' ETH'));
    kvRow(kv, 'Receipt status', textNode(f.receiptStatus == null ? 'unknown' : (f.receiptStatus === 1 ? '1 (success)' : f.receiptStatus + ' (failed)')));
    kvRow(kv, 'Verified via', textNode(f.verifiedVia));
    kvRow(kv, 'Fact hash', hashWithCopy(f.factHash));
    var explorer = window.__explorerTx || '';
    if (explorer) {
      var a = document.createElement('a');
      a.href = explorer + f.txHash; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'VIEW ON EXPLORER ↗';
      kvRow(kv, 'Explorer', a);
    }

    /* rounds */
    var r1 = (r.rounds && r.rounds[0] && r.rounds[0].votes) || [];
    var r2 = (r.rounds && r.rounds[1] && r.rounds[1].votes) || [];
    var a1 = r1.filter(function (v) { return v.vote === 'APPROVE'; }).length;
    var d1 = r1.filter(function (v) { return v.vote === 'DENY'; }).length;
    var q = r.summary.quorum;
    renderBallots($('round1Table').tBodies[0], r1, false);
    $('round1Tally').textContent = a1 + ' APPROVE / ' + d1 + ' DENY / ' + (r1.length - a1 - d1) + ' ABSTAIN — PUBLISHED AFTER CAST';
    renderBallots($('round2Table').tBodies[0], r2, true);
    $('round2Tally').textContent = 'FINAL — ' + q.approvals + ' APPROVE / ' + q.denials + ' DENY / ' + q.abstentions + ' ABSTAIN';

    /* verdict + seal */
    var verdictEl = $('verdict');
    verdictEl.className = 'verdict ' + r.summary.decision;
    $('verdictWord').textContent = r.summary.decision;
    $('verdictTally').textContent = q.approvals + '/' + q.fleetSize + ' APPROVALS (quorum ' + q.required + ') · ' +
      q.denials + ' DENY · ' + q.abstentions + ' ABSTAIN' + (r.llmVia ? ' · LLM analyst: ' + r.llmVia : '');
    $('sealDecision').textContent = r.summary.decision === 'EXECUTE' ? 'EXECUTE' : 'REJECT';
    $('sealApproval').textContent = q.approvals + ' OF ' + q.fleetSize;

    /* certificate */
    var ckv = $('certKv'); ckv.textContent = '';
    kvRow(ckv, 'Certificate hash', hashWithCopy(r.summary.certHash));
    kvRow(ckv, 'Policy id', hashWithCopy(r.policyId));
    kvRow(ckv, 'Ballot box hash', hashWithCopy(r.summary.ballotBoxHash));
    kvRow(ckv, 'Signatures', textNode(r.audit.signatures && r.audit.rehearsal ? 'ALL RECOVER (local audit + on-chain ecrecover rehearsal)' : 'AUDIT FAILED'));
    kvRow(ckv, 'Receipt', textNode(r.receipt.txHash + ' (' + r.receipt.registry + ')'));
    kvRow(ckv, 'Issued', textNode(new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z'));

    loadDocket();
    $('chamber-sec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearRefusal();
    var txHash = $('txHash').value.trim();
    var payee = $('payee').value.trim();
    var expectedEth = $('expectedEth').value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return refuse('PROCEEDING REFUSED — enter a 32-byte transaction hash (0x + 64 hex characters)');
    if (!/^0x[0-9a-fA-F]{40}$/.test(payee)) return refuse('PROCEEDING REFUSED — payee must be a 20-byte address (0x + 40 hex characters)');
    var n = Number(expectedEth);
    if (!Number.isFinite(n) || n <= 0) return refuse('PROCEEDING REFUSED — expected amount must be a positive ETH amount');

    conveneBtn.disabled = true;
    conveneBtn.textContent = 'FLEET IN DELIBERATION…';
    fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: txHash, payee: payee, expectedEth: expectedEth,
        shortBps: Number($('shortBps').value), overBps: Number($('overBps').value),
        minEth: $('minEth').value, llm: $('llmAnalyst').checked,
      }),
    }).then(function (resp) {
      return resp.json().then(function (body) { return { ok: resp.ok, body: body }; });
    }).then(function (r) {
      if (!r.ok) {
        refuse(String((r.body && r.body.error) || 'PROCEEDING REFUSED — server error'));
        return;
      }
      var explorer = (r.body.explorerTx);
      renderProceeding(r.body);
    }).catch(function () {
      refuse('PROCEEDING REFUSED — chamber server unreachable');
    }).finally(function () {
      conveneBtn.disabled = false;
      conveneBtn.textContent = 'CONVENE THE FLEET';
    });
  });

  /* explorer link base + ledger status line */
  fetch('/api/anchors').then(function (r) { return r.json(); }).then(function (data) {
    var def = (data.anchors || []).filter(function (a) { return a.label === data.default; })[0];
    if (def) window.__explorerTx = def.explorerTx || '';
  }).catch(function () { window.__explorerTx = ''; });
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) {
    $('ledgerStatus').textContent = 'receipt book: ' + (h.ledger || '') + ' · anchor of record: ' + (h.anchor || '');
  }).catch(function () { /* status line stays sparse */ });
})();
