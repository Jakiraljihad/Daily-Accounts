// ================================================================
//  bot.js  v2.0 — Daily Account Notice Bot
//  Features:
//    ✅ Public notice (সবার জন্য)
//    ✅ Personal message (নির্দিষ্ট user-এর জন্য)
//    ✅ Install tracker + device info (model, OS, screen)
//    ✅ /users — সব user তালিকা + বিস্তারিত
//    ✅ /notice — guided wizard
//    ✅ /pm — ব্যক্তিগত মেসেজ wizard
//    ✅ /forceupdate — জরুরি আপডেট
//    ✅ Quick notice — শুধু টেক্সট পাঠালেই হবে
// ================================================================

const { Telegraf } = require('telegraf');
const http = require('http');

const BOT_TOKEN = '8750026901:AAEI5DehYfYN2yZmmrCq7CMhS9PFnkhbaDY';
const OWNER_ID  = '7403991298';
const PORT      = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);

// ══════════════════════════════════════════════════════
//  IN-MEMORY STORAGE
// ══════════════════════════════════════════════════════
let activeNotice   = null;
let noticeCounter  = 1;
const users        = {};      // appUid → user object
const personalMsgs = {};      // appUid → personal notice
const uStates      = {};      // telegramUserId → wizard state
const uDrafts      = {};      // telegramUserId → draft object

// ══════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════
const ICONS = [
  '📢','🎉','⚡','🔥','💡','⚠️','✅','🚀',
  '📱','🎯','💰','🛠️','❤️','⭐','🔔','🎁',
  '📣','🏆','🌟','💎','🎀','🔑','💌','🎪'
];

const TYPES = [
  { key:'info',    label:'ℹ️ তথ্য (নীল)'       },
  { key:'update',  label:'🚀 আপডেট (বেগুনি)'   },
  { key:'warning', label:'⚠️ সতর্কতা (কমলা)'  },
  { key:'success', label:'✅ সাফল্য (সবুজ)'    },
  { key:'danger',  label:'🚨 জরুরি (লাল)'      }
];

const PAGE_SIZE = 8;

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════
const isOwner = ctx => String(ctx.from?.id) === String(OWNER_ID);
const tuid    = ctx => ctx.from.id;
const reset   = id  => { delete uStates[id]; delete uDrafts[id]; };

function typeKb() {
  const rows = [];
  for (let i = 0; i < TYPES.length; i += 2)
    rows.push(TYPES.slice(i, i+2).map(t => ({ text: t.label, callback_data: 'type:' + t.key })));
  return { inline_keyboard: rows };
}

function iconKb() {
  const rows = [];
  for (let i = 0; i < ICONS.length; i += 4)
    rows.push(ICONS.slice(i, i+4).map((ic, j) => ({ text: ic, callback_data: 'icon:' + (i+j) })));
  rows.push([{ text: '✏️ নিজে লিখুন', callback_data: 'icon:custom' }]);
  return { inline_keyboard: rows };
}

function confirmKb(persistent, isPM) {
  return {
    inline_keyboard: [
      [
        { text: '✅ পাঠান',  callback_data: isPM ? 'pm_send' : 'do_send' },
        { text: persistent ? '📌 Persistent ✅' : '📌 Persistent ❌', callback_data: 'toggle_pers' }
      ],
      [{ text: '❌ বাতিল', callback_data: 'do_cancel' }]
    ]
  };
}

function previewText(d) {
  const head = d.isPersonal
    ? '👤 *ব্যক্তিগত নোটিস*\n🎯 User: `' + (d.targetUid || '?') + '`\n\n'
    : '📢 *Public নোটিস প্রিভিউ:*\n\n';
  return (
    head +
    (d.icon || '📢') + ' *' + (d.title || '_(শিরোনাম নেই)_') + '*\n\n' +
    '_' + (d.message || '') + '_\n\n' +
    (d.link ? '🔗 ' + d.link + '\n' : '') +
    '🎨 রঙ: `' + (d.type || 'info') + '`\n' +
    '📌 Persistent: ' + (d.persistent ? '✅' : '❌')
  );
}

function userSummary() {
  const total = Object.keys(users).length;
  const today = new Date().toDateString();
  const todayNew = Object.values(users)
    .filter(u => u.installDate && new Date(u.installDate).toDateString() === today).length;
  return `👥 মোট: *${total}* জন  |  আজ নতুন: *${todayNew}* জন`;
}

function userCard(u) {
  return (
    `🆔 \`${u.uid}\`\n` +
    `📱 ডিভাইস: *${u.device || 'Unknown'}*\n` +
    `💻 OS: ${u.os || 'Unknown'}\n` +
    `📐 স্ক্রিন: ${u.screen || '?'}\n` +
    `🌐 ভাষা: ${u.lang || '?'}\n` +
    `🕐 Timezone: ${u.tz || '?'}\n` +
    `🔢 Session: *${u.sessions || 1}*\n` +
    `📅 Install: ${u.installDate ? new Date(u.installDate).toLocaleString('bn-BD') : '?'}\n` +
    `👁️ শেষ দেখা: ${u.lastSeen ? new Date(u.lastSeen).toLocaleString('bn-BD') : '?'}\n` +
    `🚀 App v${u.ver || '?'}`
  );
}

// ══════════════════════════════════════════════════════
//  /start
// ══════════════════════════════════════════════════════
bot.command('start', ctx => {
  if (!isOwner(ctx)) return ctx.reply('❌ অ্যাক্সেস নেই।');
  ctx.reply(
    '👋 *Daily Account Notice Bot* v2.0 🚀\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    '📤 /notice — সবার জন্য নোটিস\n' +
    '💌 /pm — নির্দিষ্ট user-কে মেসেজ\n' +
    '👥 /users — সব user তালিকা\n' +
    '📋 /status — বর্তমান অবস্থা\n' +
    '❌ /clear — public নোটিস বন্ধ\n' +
    '🗑️ /clearpm — PM মুছুন\n' +
    '⛔ /forceupdate — জরুরি আপডেট\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '💡 _যেকোনো টেক্সট পাঠালে তাৎক্ষণিক নোটিস!_',
    { parse_mode: 'Markdown' }
  );
});

// ══════════════════════════════════════════════════════
//  /users
// ══════════════════════════════════════════════════════
bot.command('users', ctx => {
  if (!isOwner(ctx)) return;
  const all = Object.values(users);
  if (!all.length) return ctx.reply('📭 এখনো কেউ install করেনি।');
  sendUserPage(ctx, 0, false);
});

function sendUserPage(ctx, page, isEdit) {
  const all = Object.values(users).sort(
    (a, b) => new Date(b.installDate||0) - new Date(a.installDate||0)
  );
  const total = all.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const slice = all.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE);

  let text = userSummary() + '\n━━━━━━━━━━━━━━━━━━━━━━\n\n';
  slice.forEach((u, i) => {
    const n = page * PAGE_SIZE + i + 1;
    const hasPM = !!personalMsgs[u.uid];
    text += `*${n}.* ${u.device || 'Unknown'} ${hasPM ? '💌' : ''}\n`;
    text += `    🆔 \`${u.uid}\` • ${u.sessions||1} session • v${u.ver||'?'}\n\n`;
  });

  const userBtns = slice.map(u => [
    { text: '👁️ ' + (u.uid||'').substring(0,12), callback_data: 'uview:' + u.uid },
    { text: '💌 PM',                               callback_data: 'upm:'   + u.uid }
  ]);

  const nav = [];
  if (page > 0)         nav.push({ text: '⬅️',  callback_data: 'upage:' + (page-1) });
  nav.push({ text: page+1 + '/' + pages, callback_data: 'noop' });
  if (page < pages - 1) nav.push({ text: '➡️', callback_data: 'upage:' + (page+1) });

  const kb = { inline_keyboard: [...userBtns, nav] };
  const opts = { parse_mode: 'Markdown', reply_markup: kb };

  if (isEdit) {
    ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
    ctx.answerCbQuery();
  } else {
    ctx.reply(text, opts);
  }
}

bot.action('noop', ctx => ctx.answerCbQuery());

bot.action(/^upage:(\d+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  sendUserPage(ctx, parseInt(ctx.match[1]), true);
});

bot.action(/^uview:(.+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const u = users[ctx.match[1]];
  if (!u) return ctx.answerCbQuery('❌ User পাওয়া যায়নি');
  const hasPM = !!personalMsgs[u.uid];
  ctx.editMessageText(
    '📋 *User বিস্তারিত:*\n\n' + userCard(u) + (hasPM ? '\n\n💌 *ব্যক্তিগত মেসেজ সক্রিয়!*' : ''),
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💌 ব্যক্তিগত মেসেজ পাঠান', callback_data: 'upm:' + u.uid }],
          ...(hasPM ? [[{ text: '🗑️ PM মুছুন', callback_data: 'delpm:' + u.uid }]] : []),
          [{ text: '⬅️ তালিকায় ফিরুন', callback_data: 'upage:0' }]
        ]
      }
    }
  );
  ctx.answerCbQuery();
});

bot.action(/^delpm:(.+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  delete personalMsgs[ctx.match[1]];
  ctx.answerCbQuery('🗑️ PM মুছে গেছে');
  // Refresh view
  const u = users[ctx.match[1]];
  if (u) ctx.editMessageText('✅ `' + ctx.match[1] + '`-এর PM মুছে গেছে।', { parse_mode: 'Markdown' });
});

// ══════════════════════════════════════════════════════
//  /pm — Personal Message
// ══════════════════════════════════════════════════════
bot.command('pm', ctx => {
  if (!isOwner(ctx)) return;
  reset(tuid(ctx));
  uDrafts[tuid(ctx)] = { isPersonal: true };
  const all = Object.values(users);
  if (!all.length) return ctx.reply('📭 কোনো user নেই।');

  const rows = all.slice(0, 20).map(u => [{
    text: (u.device||'?').substring(0,20) + ' — ' + u.uid.substring(0,12),
    callback_data: 'pmsel:' + u.uid
  }]);
  rows.push([{ text: '✏️ ID নিজে লিখুন', callback_data: 'pmsel:manual' }]);

  ctx.reply('💌 *কাকে মেসেজ পাঠাবেন?*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows }
  });
});

bot.action(/^upm:(.+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  startPMWizard(ctx, ctx.match[1]);
});

bot.action(/^pmsel:(.+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  if (ctx.match[1] === 'manual') {
    uStates[tuid(ctx)] = 'pm_uid';
    ctx.editMessageText('✏️ *User ID লিখুন:*\n_(যেমন: DA1A2B3C4D)_', { parse_mode: 'Markdown' });
  } else {
    startPMWizard(ctx, ctx.match[1]);
  }
  ctx.answerCbQuery();
});

function startPMWizard(ctx, targetUid) {
  reset(tuid(ctx));
  uDrafts[tuid(ctx)] = { isPersonal: true, targetUid };
  uStates[tuid(ctx)] = 'type';
  const u = users[targetUid];
  const label = u ? '📱 ' + u.device : '🆔 ' + targetUid;
  const fn = ctx.callbackQuery
    ? (t, o) => ctx.editMessageText(t, o).catch(() => ctx.reply(t, o))
    : (t, o) => ctx.reply(t, o);
  fn('💌 *ব্যক্তিগত নোটিস*\n' + label + '\n\n🎨 *রঙ বেছে নিন:*', {
    parse_mode: 'Markdown', reply_markup: typeKb()
  });
}

// ══════════════════════════════════════════════════════
//  /notice — Public wizard
// ══════════════════════════════════════════════════════
bot.command('notice', ctx => {
  if (!isOwner(ctx)) return;
  reset(tuid(ctx));
  uDrafts[tuid(ctx)] = { isPersonal: false };
  uStates[tuid(ctx)] = 'type';
  ctx.reply('📢 *সবার জন্য নোটিস*\n\n🎨 *রঙ বেছে নিন:*', {
    parse_mode: 'Markdown', reply_markup: typeKb()
  });
});

// ── Type ──
bot.action(/^type:(.+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const d = uDrafts[tuid(ctx)] || {};
  d.type = ctx.match[1];
  uDrafts[tuid(ctx)] = d;
  uStates[tuid(ctx)] = 'icon';
  ctx.editMessageText('🎯 *আইকন বেছে নিন:*', {
    parse_mode: 'Markdown', reply_markup: iconKb()
  });
  ctx.answerCbQuery();
});

// ── Icon ──
bot.action(/^icon:(.+)$/, ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const val = ctx.match[1];
  const d   = uDrafts[tuid(ctx)] || {};
  if (val === 'custom') {
    uStates[tuid(ctx)] = 'custom_icon';
    ctx.editMessageText('✏️ *আইকন ইমোজি লিখুন:*', { parse_mode: 'Markdown' });
  } else {
    d.icon = ICONS[parseInt(val)] || '📢';
    uDrafts[tuid(ctx)] = d;
    uStates[tuid(ctx)] = 'title';
    ctx.editMessageText('📝 *শিরোনাম লিখুন:*\n_(/skip — ছাড়িয়ে যান)_', { parse_mode: 'Markdown' });
  }
  ctx.answerCbQuery();
});

// ── Confirm send (public) ──
bot.action('do_send', ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const d = uDrafts[tuid(ctx)] || {};
  activeNotice = buildNotice('n', d);
  reset(tuid(ctx));
  ctx.editMessageText(
    '✅ *নোটিস পাঠানো হয়েছে!*\n\n👥 ' + Object.keys(users).length + ' জন দেখবেন।\n❌ /clear',
    { parse_mode: 'Markdown' }
  );
  ctx.answerCbQuery('✅ সক্রিয়');
});

// ── Confirm send (personal) ──
bot.action('pm_send', ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const d = uDrafts[tuid(ctx)] || {};
  if (!d.targetUid) return ctx.answerCbQuery('❌ User ID নেই');
  personalMsgs[d.targetUid] = buildNotice('pm', d, true);
  reset(tuid(ctx));
  ctx.editMessageText(
    '💌 *ব্যক্তিগত মেসেজ পাঠানো হয়েছে!*\n👤 `' + d.targetUid + '`\n\nপরের বার অ্যাপ খুললেই দেখবেন।',
    { parse_mode: 'Markdown' }
  );
  ctx.answerCbQuery('💌 PM সক্রিয়');
});

function buildNotice(prefix, d, isPersonal) {
  return {
    id:         prefix + (noticeCounter++),
    active:     true,
    type:       d.type      || 'info',
    icon:       d.icon      || (isPersonal ? '💌' : '📢'),
    title:      d.title     || '',
    message:    d.message   || '',
    link:       d.link      || null,
    linkText:   d.linkText  || null,
    persistent: d.persistent|| false,
    isPersonal: !!isPersonal
  };
}

// ── Toggle persistent ──
bot.action('toggle_pers', ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const d = uDrafts[tuid(ctx)];
  if (!d) return ctx.answerCbQuery();
  d.persistent = !d.persistent;
  ctx.editMessageText(previewText(d), {
    parse_mode: 'Markdown',
    reply_markup: confirmKb(d.persistent, d.isPersonal)
  });
  ctx.answerCbQuery(d.persistent ? '📌 Persistent চালু' : '📌 বন্ধ');
});

// ── Cancel ──
bot.action('do_cancel', ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  reset(tuid(ctx));
  ctx.editMessageText('❌ বাতিল।');
  ctx.answerCbQuery();
});

// ── Force update ──
bot.action('do_force', ctx => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const d = uDrafts[tuid(ctx)] || {};
  activeNotice = {
    id: 'f' + (noticeCounter++), active: true, forceUpdate: true,
    minVersionCode:     d.minVersionCode     || 999,
    forceUpdateTitle:   d.forceUpdateTitle   || '⛔ আপডেট করুন!',
    forceUpdateMessage: d.forceUpdateMessage || 'এই ভার্সন আর কাজ করবে না।',
    updateLink:         d.updateLink         || null
  };
  reset(tuid(ctx));
  ctx.editMessageText('⛔ *ফোর্স আপডেট সক্রিয়!*', { parse_mode: 'Markdown' });
  ctx.answerCbQuery('⛔ চালু');
});

bot.action('cancel_force', ctx => {
  reset(tuid(ctx));
  ctx.editMessageText('❌ বাতিল।');
  ctx.answerCbQuery();
});

// ══════════════════════════════════════════════════════
//  TEXT HANDLER
// ══════════════════════════════════════════════════════
bot.on('text', ctx => {
  if (!isOwner(ctx)) return;
  const id   = tuid(ctx);
  const text = ctx.message.text.trim();
  const st   = uStates[id];
  const d    = uDrafts[id] || {};
  const skip = text === '/skip';

  // Quick notice
  if (!st && !text.startsWith('/')) {
    activeNotice = {
      id: 'q' + (noticeCounter++), active: true, type: 'info',
      icon: '📢', title: 'নতুন বার্তা', message: text, persistent: false
    };
    return ctx.reply(
      '✅ *দ্রুত নোটিস পাঠানো হয়েছে!*\n\n💬 _' +
      text.substring(0, 80) + (text.length > 80 ? '...' : '') + '_\n\n' +
      '👥 ' + Object.keys(users).length + ' জন  |  ❌ /clear',
      { parse_mode: 'Markdown' }
    );
  }

  if (st === 'pm_uid') {
    uDrafts[id].targetUid = text;
    uStates[id] = 'type';
    return ctx.reply('💌 User: `' + text + '`\n\n🎨 *রঙ:*', {
      parse_mode: 'Markdown', reply_markup: typeKb()
    });
  }

  if (st === 'custom_icon') {
    d.icon = text; uDrafts[id] = d;
    uStates[id] = 'title';
    return ctx.reply('📝 *শিরোনাম:*\n_(/skip)_', { parse_mode: 'Markdown' });
  }

  if (st === 'title') {
    d.title = skip ? '' : text; uDrafts[id] = d;
    uStates[id] = 'message';
    return ctx.reply('💬 *বার্তা লিখুন:*', { parse_mode: 'Markdown' });
  }

  if (st === 'message') {
    d.message = text; uDrafts[id] = d;
    uStates[id] = 'link';
    return ctx.reply('🔗 *লিংক:*\n_(/skip)_', { parse_mode: 'Markdown' });
  }

  if (st === 'link') {
    if (!skip) d.link = text; uDrafts[id] = d;
    if (skip) return showPreview(ctx, id);
    uStates[id] = 'link_text';
    return ctx.reply('🔘 *বাটনের লেখা:*\n_(/skip — ডিফল্ট)_', { parse_mode: 'Markdown' });
  }

  if (st === 'link_text') {
    if (!skip) d.linkText = text; uDrafts[id] = d;
    return showPreview(ctx, id);
  }

  if (st === 'force_title') {
    d.forceUpdateTitle = skip ? '' : text; uDrafts[id] = d;
    uStates[id] = 'force_message';
    return ctx.reply('💬 *বার্তা:*\n_(/skip)_', { parse_mode: 'Markdown' });
  }
  if (st === 'force_message') {
    d.forceUpdateMessage = skip ? '' : text; uDrafts[id] = d;
    uStates[id] = 'force_link';
    return ctx.reply('🔗 *ডাউনলোড লিংক:*\n_(/skip)_', { parse_mode: 'Markdown' });
  }
  if (st === 'force_link') {
    if (!skip) d.updateLink = text; uDrafts[id] = d;
    uStates[id] = 'force_version';
    return ctx.reply('📱 *মিন ভার্সন কোড:*\n_(যেমন: 6 — এর নিচে ব্লক হবে)_', { parse_mode: 'Markdown' });
  }
  if (st === 'force_version') {
    d.minVersionCode = parseInt(text) || 999; uDrafts[id] = d;
    uStates[id] = 'force_confirm';
    return ctx.reply(
      '⛔ *প্রিভিউ:*\n\n🚨 *' + (d.forceUpdateTitle || '⛔ আপডেট করুন!') + '*\n' +
      '_' + (d.forceUpdateMessage || '') + '_\n' +
      '🔗 ' + (d.updateLink || '_(নেই)_') + '\n📱 মিন কোড: `' + d.minVersionCode + '`',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⛔ সক্রিয় করুন', callback_data: 'do_force'    }],
            [{ text: '❌ বাতিল',         callback_data: 'cancel_force' }]
          ]
        }
      }
    );
  }
});

function showPreview(ctx, id) {
  const d = uDrafts[id];
  uStates[id] = 'confirm';
  ctx.reply(previewText(d), {
    parse_mode: 'Markdown',
    reply_markup: confirmKb(d.persistent, d.isPersonal)
  });
}

// ══════════════════════════════════════════════════════
//  /status
// ══════════════════════════════════════════════════════
bot.command('status', ctx => {
  if (!isOwner(ctx)) return;
  let text = userSummary() + '\n━━━━━━━━━━━━━━━━━━━━━━\n\n';
  if (!activeNotice) {
    text += '📭 কোনো সক্রিয় public নোটিস নেই।\n\n';
  } else {
    const n = activeNotice;
    text += (n.forceUpdate ? '⛔ *ফোর্স আপডেট চালু!*\n\n' : '') +
      (n.icon||'') + ' *' + (n.title||'(শিরোনাম নেই)') + '*\n' +
      '_' + (n.message||'') + '_\n' +
      '🎨 `' + (n.type||'force') + '`  📌 ' + (n.persistent?'Persistent':'Dismissible') + '\n\n';
  }
  text += '💌 ব্যক্তিগত মেসেজ: *' + Object.keys(personalMsgs).length + '* টি সক্রিয়';
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// ══════════════════════════════════════════════════════
//  /clear & /clearpm
// ══════════════════════════════════════════════════════
bot.command('clear', ctx => {
  if (!isOwner(ctx)) return;
  activeNotice = null;
  ctx.reply('✅ *Public নোটিস বন্ধ।*', { parse_mode: 'Markdown' });
});

bot.command('clearpm', ctx => {
  if (!isOwner(ctx)) return;
  const args = ctx.message.text.split(' ');
  if (args.length < 2 || !args[1]) {
    return ctx.reply(
      '💡 ব্যবহার:\n`/clearpm all` — সব PM মুছুন\n`/clearpm DA1234ABCD` — নির্দিষ্ট user',
      { parse_mode: 'Markdown' }
    );
  }
  if (args[1] === 'all') {
    const c = Object.keys(personalMsgs).length;
    for (const k in personalMsgs) delete personalMsgs[k];
    ctx.reply('✅ *' + c + '* টি PM মুছে গেছে।', { parse_mode: 'Markdown' });
  } else {
    if (personalMsgs[args[1]]) {
      delete personalMsgs[args[1]];
      ctx.reply('✅ `' + args[1] + '`-এর PM মুছে গেছে।', { parse_mode: 'Markdown' });
    } else {
      ctx.reply('❌ এই user-এর PM নেই।');
    }
  }
});

// ══════════════════════════════════════════════════════
//  /forceupdate
// ══════════════════════════════════════════════════════
bot.command('forceupdate', ctx => {
  if (!isOwner(ctx)) return;
  reset(tuid(ctx));
  uDrafts[tuid(ctx)] = { forceUpdate: true };
  uStates[tuid(ctx)] = 'force_title';
  ctx.reply('⛔ *ফোর্স আপডেট উইজার্ড*\n\nশিরোনাম:\n_(/skip — ডিফল্ট)_', { parse_mode: 'Markdown' });
});

// ══════════════════════════════════════════════════════
//  HTTP API SERVER
// ══════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];

  // GET /api/notice
  if (url === '/api/notice' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, notice: activeNotice }));
  }

  // GET /api/personal/:uid
  if (url.startsWith('/api/personal/') && req.method === 'GET') {
    const puid = decodeURIComponent(url.replace('/api/personal/', ''));
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, notice: personalMsgs[puid] || null }));
  }

  // POST /api/register
  if (url === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data   = JSON.parse(body);
        const appUid = data.uid;
        if (!appUid) throw new Error('No uid');

        const isNew = !users[appUid];
        const prev  = users[appUid] || {};

        users[appUid] = {
          uid:         appUid,
          device:      data.device      || prev.device      || 'Unknown',
          os:          data.os          || prev.os          || 'Unknown',
          screen:      data.screen      || prev.screen      || '?',
          lang:        data.lang        || prev.lang        || '?',
          tz:          data.tz          || prev.tz          || '?',
          ver:         data.ver         || prev.ver         || '?',
          installDate: isNew ? new Date().toISOString() : prev.installDate,
          lastSeen:    new Date().toISOString(),
          sessions:    (prev.sessions || 0) + 1
        };

        if (isNew) {
          const u = users[appUid];
          bot.telegram.sendMessage(OWNER_ID,
            '🎉 *নতুন Install!*\n' +
            '━━━━━━━━━━━━━━━━\n' +
            '🆔 `' + u.uid      + '`\n' +
            '📱 ' + u.device    + '\n' +
            '💻 OS: ' + u.os    + '\n' +
            '📐 ' + u.screen    + '\n' +
            '🌐 ' + u.lang      + '  •  🕐 ' + u.tz + '\n' +
            '🚀 v' + u.ver      + '\n' +
            '━━━━━━━━━━━━━━━━\n' +
            '👥 মোট: *' + Object.keys(users).length + '* জন',
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        } else if (users[appUid].sessions % 10 === 0) {
          const u = users[appUid];
          bot.telegram.sendMessage(OWNER_ID,
            '📈 *Active User*\n🆔 `' + u.uid + '`\n📱 ' + u.device + '\n🔄 Session: *' + u.sessions + '*\n🚀 v' + u.ver,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, isNew }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /api/stats
  if (url === '/api/stats' && req.method === 'GET') {
    const today = new Date().toDateString();
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({
      ok: true,
      totalUsers:   Object.keys(users).length,
      todayNew:     Object.values(users).filter(u => u.installDate && new Date(u.installDate).toDateString() === today).length,
      activeNotice: !!activeNotice,
      pendingPMs:   Object.keys(personalMsgs).length
    }));
  }

  // Home dashboard
  if (url === '/') {
    const today = new Date().toDateString();
    const todayNew = Object.values(users).filter(u => u.installDate && new Date(u.installDate).toDateString() === today).length;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    return res.end(`<!DOCTYPE html><html><head>
<title>Daily Account Bot</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080c14;color:#e0e0e0;font-family:system-ui,sans-serif;padding:32px 16px;text-align:center}
  h1{font-size:1.8em;color:#00e676;margin-bottom:6px}
  p.sub{color:#666;margin-bottom:28px;font-size:.9em}
  .grid{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;margin-bottom:28px}
  .card{background:#0f1520;border:1px solid #1e2a40;border-radius:14px;padding:20px 28px;min-width:130px}
  .card .n{font-size:2.2em;font-weight:700;color:#00b4ff}
  .card .l{font-size:.8em;color:#556;margin-top:6px;text-transform:uppercase;letter-spacing:.06em}
  .links a{color:#00e676;margin:0 10px;text-decoration:none;font-size:.9em}
</style></head><body>
<h1>🤖 Daily Account Notice Bot</h1>
<p class="sub">Bot চালু আছে ✅</p>
<div class="grid">
  <div class="card"><div class="n">${Object.keys(users).length}</div><div class="l">Total Users</div></div>
  <div class="card"><div class="n">${todayNew}</div><div class="l">আজ নতুন</div></div>
  <div class="card"><div class="n">${activeNotice ? '✅' : '—'}</div><div class="l">Active Notice</div></div>
  <div class="card"><div class="n">${Object.keys(personalMsgs).length}</div><div class="l">Pending PMs</div></div>
</div>
<div class="links">
  <a href="/api/notice">/api/notice</a>
  <a href="/api/stats">/api/stats</a>
</div>
</body></html>`);
  }

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false }));
});

server.listen(PORT, () => console.log('🚀 HTTP Server → port', PORT));

bot.launch();
console.log('🤖 Bot চালু!');

process.once('SIGINT',  () => { bot.stop('SIGINT');  server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
