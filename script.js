// 西新井橋緑地
SHISETSU_CODE = '033';

const SHITSUJO_CODES = {
  A: '001-0',
  B: '002-0',
  C: '003-0',
  D: '004-0',
  E: '005-0',
  F: '006-0',
  G: '007-0',
  H: '008-0',
  I: '009-0',
  J: '010-0',
};

const SHITSUJO_KEYS = {
  A: '001|ZZ|0',
  B: '002|ZZ|0',
  C: '003|ZZ|0',
  D: '004|ZZ|0',
  E: '005|ZZ|0',
  F: '006|ZZ|0',
  G: '007|ZZ|0',
  H: '008|ZZ|0',
  I: '009|ZZ|0',
  J: '010|ZZ|0',
};

const SHITSUJO_BY_CODE = Object.fromEntries(
  Object.entries(SHITSUJO_CODES).map(([key, value]) => [value.slice(0, 3), key]),
);
const SELECTED_SLOT_CLASS = 'adachi-yoyaku-assist-selected-slot';
const AUTO_RUN_HOLIDAY_KEY = 'adachi-yoyaku-assist-auto-run-holiday';
const TIME_RANGES_STORAGE_KEY = 'timeRangesByDate';
const PERIOD_PAGE_TITLE_PATTERN = /^期間の空き状況(?:$| ::)/;
const YMD_PATTERN = /^20\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const selectedSlotMap = new Map();
const timeRangesByDate = new Map();
let requestCodeBlock = null;
let runRequestButton = null;

const getCurrentH2Text = () => document.querySelector('h2')?.textContent ?? '';
const isPeriodPage = (h2Text = getCurrentH2Text()) =>
  PERIOD_PAGE_TITLE_PATTERN.test(h2Text);
const getSlotKey = (date, range, shitsujo) => `${date}-${range}-${shitsujo}`;

const post = (action, fields, target) => {
  const form = document.createElement('form');
  if (target) form.target = target;
  form.method = 'POST';
  form.action = action;

  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  form.remove();
};

const ensureAssistStyle = () => {
  if (document.getElementById('adachi-yoyaku-assist-style')) return;
  const style = document.createElement('style');
  style.id = 'adachi-yoyaku-assist-style';
  style.textContent = `
    .${SELECTED_SLOT_CLASS} {
      box-shadow: inset 0 0 0 3px #ff2c2c;
    }
  `;
  document.head.appendChild(style);
};

const parseShitsujoFromRow = (row) => {
  const firstCellText = row.querySelector('td')?.textContent.replace(/\s+/g, '') ?? '';
  const nameMatch = firstCellText.match(/([A-J])面/);
  if (!nameMatch) {
    throw new Error(`室場名を行テキストから抽出できません: "${firstCellText}"`);
  }
  return nameMatch[1];
};

const readHeaderHours = (table) => {
  const headerRow = [...table.querySelectorAll('tr')].find((tr) =>
    tr.querySelector('th'),
  );
  if (!headerRow) return null;
  const ths = [...headerRow.querySelectorAll('th')];
  if (ths.length < 2) return null;
  const hours = ths
    .slice(1)
    .map((th) => Number(th.textContent.trim()))
    .filter((hour) => Number.isFinite(hour));
  return hours.length > 0 ? hours : null;
};

const readHalfHourWidth = (table) => {
  const widths = [...table.querySelectorAll('tr th')]
    .slice(1)
    .map((th) => {
      const match = th.getAttribute('style')?.match(/width:\s*([\d.]+)px/);
      return match ? Number(match[1]) : null;
    })
    .filter((width) => Number.isFinite(width));
  if (widths.length === 0) return null;
  const avgHourWidth = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  return avgHourWidth / 2;
};

const parseWidthPx = (element) => {
  const match = element.getAttribute('style')?.match(/width:\s*([\d.]+)px/);
  return match ? Number(match[1]) : null;
};

const collectTimeRangesFromSlotCells = (slotCells, firstHour, halfHourWidth) => {
  if (!Number.isFinite(firstHour) || !Number.isFinite(halfHourWidth)) return [];
  const timeRanges = [];
  let cursorHalfHour = firstHour * 2;
  for (const cell of slotCells) {
    const widthPx = parseWidthPx(cell);
    const halfHourUnits =
      Number.isFinite(widthPx) && halfHourWidth > 0
        ? Math.max(1, Math.round(widthPx / halfHourWidth))
        : Math.max(1, 2 * (Number(cell.colSpan) || 1));
    const hasVisibleText = cell.textContent.replace(/\s|\u00A0/g, '') !== '';
    const isSlotCell = halfHourUnits >= 2 && hasVisibleText;
    if (isSlotCell) {
      const fromTotalMinutes = cursorHalfHour * 30;
      const toTotalMinutes = (cursorHalfHour + halfHourUnits) * 30;
      const fromClock = `${String(Math.floor(fromTotalMinutes / 60)).padStart(2, '0')}${String(
        fromTotalMinutes % 60,
      ).padStart(2, '0')}`;
      const toClock = `${String(Math.floor(toTotalMinutes / 60)).padStart(2, '0')}${String(
        toTotalMinutes % 60,
      ).padStart(2, '0')}`;
      timeRanges.push(`${fromClock}${toClock}`);
    }
    cursorHalfHour += halfHourUnits;
  }
  return timeRanges;
};

const mergeTimeRangesByDate = (source) => {
  for (const [date, ranges] of Object.entries(source)) {
    if (!YMD_PATTERN.test(date) || !Array.isArray(ranges) || ranges.length === 0)
      continue;
    if (!timeRangesByDate.has(date)) {
      timeRangesByDate.set(date, ranges);
    }
  }
};

const loadTimeRangesByDateFromStorage = async () => {
  const { [TIME_RANGES_STORAGE_KEY]: saved } = await chrome.storage.local.get(
    TIME_RANGES_STORAGE_KEY,
  );
  if (!saved || typeof saved !== 'object') return;
  mergeTimeRangesByDate(saved);
};

const saveTimeRangesByDateToStorage = async () => {
  const { [TIME_RANGES_STORAGE_KEY]: current } = await chrome.storage.local.get(
    TIME_RANGES_STORAGE_KEY,
  );
  console.log(timeRangesByDate);
  const merged = { ...(current ?? {}), ...Object.fromEntries(timeRangesByDate) };
  await chrome.storage.local.set({ [TIME_RANGES_STORAGE_KEY]: merged });
};

const getSelectedSlots = () =>
  [...selectedSlotMap.values()].sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
    if (a[1] !== b[1]) return a[1].localeCompare(b[1]);
    return a[2].localeCompare(b[2]);
  });

const renderRequestRunner = () => {
  if (!requestCodeBlock || !runRequestButton) return;
  const slots = getSelectedSlots();
  if (slots.length === 0) {
    requestCodeBlock.textContent = 'request([]);';
    runRequestButton.disabled = true;
    runRequestButton.style.opacity = '0.55';
    runRequestButton.style.cursor = 'not-allowed';
    return;
  }
  const body = slots
    .map((slot) => `  ['${slot[0]}', '${slot[1]}', '${slot[2]}'],`)
    .join('\n');
  requestCodeBlock.textContent = `request([\n${body}\n]);`;
  runRequestButton.disabled = false;
  runRequestButton.style.opacity = '1';
  runRequestButton.style.cursor = 'pointer';
};

const setSlotSelected = (slot, selected) => {
  const [date, range, shitsujo] = slot;
  const key = getSlotKey(date, range, shitsujo);
  if (selected) {
    selectedSlotMap.set(key, slot);
  } else {
    selectedSlotMap.delete(key);
  }
  const cells = document.querySelectorAll(
    `.SelectCalendar td[data-slot-date="${date}"][data-slot-range="${range}"][data-slot-shitsujo="${shitsujo}"]`,
  );
  for (const cell of cells) {
    cell.classList.toggle(SELECTED_SLOT_CLASS, selected);
  }
  renderRequestRunner();
};

const request = async (slots) => {
  if (slots.length === 0) return;
  if (timeRangesByDate.size === 0) {
    await loadTimeRangesByDateFromStorage();
  }
  let firstDayOfMonth = null;
  let shitsujoCode = null;
  const pairs = slots.map((slot) => {
    const [date, timeRange, shitsujo] = slot;
    if (!YMD_PATTERN.test(date)) {
      throw new Error(`Invalid date format: ${date}`);
    }
    firstDayOfMonth = date.slice(0, 6) + '01';
    const slashDate = date.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3');
    if (typeof timeRange !== 'string' || !/^\d{8}$/.test(timeRange)) {
      throw new Error(`Invalid time range: ${timeRange} (must be 'HHMMHHMM')`);
    }

    if (!(shitsujo in SHITSUJO_CODES && shitsujo in SHITSUJO_KEYS)) {
      throw new Error(`Invalid shitsujo: ${shitsujo}`);
    }
    shitsujoCode = SHITSUJO_CODES[shitsujo];
    const shitsujoKey = SHITSUJO_KEYS[shitsujo];
    const timeRanges = timeRangesByDate.get(date);
    if (!timeRanges || timeRanges.length === 0) {
      throw new Error(`time ranges are missing: date=${date}`);
    }
    const slotIndex = timeRanges.indexOf(timeRange);
    if (slotIndex < 0) {
      const available = timeRanges.join(', ');
      throw new Error(
        `slot not found: date=${date} range=${timeRange} available=[${available}]`,
      );
    }

    return [
      `rsv_chk[${SHISETSU_CODE}|${shitsujoKey}|2|0][${slashDate}][${slotIndex}]`,
      timeRange,
    ];
  });

  post('index.php', [
    ['op', 'apply'],
    ['UseDate', firstDayOfMonth],
    ['ShisetsuCode', SHISETSU_CODE],
    ['scd', SHISETSU_CODE],
    ['StjCmbCode', shitsujoCode],
    ['disp_span', '0'],
    ...pairs,
    ['requestBtn', ''],
  ]);
};

const process申込トレイ = () => {
  // 「使用目的」「使用人数」が未入力の場合は「申込情報入力」画面へ遷移
  if (
    [...document.querySelectorAll('form[name="forma"] span.f-red')].some((e) =>
      ['使用目的が選択されていません。', '使用人員が入力されていません。'].includes(
        e.textContent,
      ),
    )
  ) {
    // 「情報入力」ボタンをクリック
    document.getElementsByName('detailBtn[0]')[0].click();
    return;
    // POSTリクエストでも可能
    //post('index.php', [
    //  ['op', 'apply'],
    //  ['idx', '0'],
    //  ['useninzu', '20'],
    //  ['answer[1]', ''],
    //  ['mokutekicode', '038'],
    //  ['copy_chk', '0'],
    //  ['setInfoBtn', ''],
    //]);
  }

  // エラーメッセージが表示されていない場合は申込み
  if (
    [...document.querySelectorAll('form[name="forma"] .f-red')].every(
      (e) => e.tagName === 'I',
    )
  ) {
    // 「申込み」ボタンをクリック
    //document.getElementsByName('applyBtn')[0].click();
    return;
  }
};

const process申込情報入力 = () => {
  // 使用人員 => 20
  document.querySelector('input[name="useninzu"]').value = '20';
  // 使用目的 => 少年軟式野球
  [
    ...document
      .querySelector('input[name="mokutekicode"]')
      .parentNode.querySelectorAll('label'),
  ]
    .find((e) => e.textContent === '少年軟式野球')
    .click();
  // 「他の申込も同じ設定にする。」チェックボックスをON
  document.getElementsByName('copy_chk')[0].checked = true;
  // 「確定」ボタンをクリック
  document.getElementsByName('setInfoBtn')[0].click();
};

const postToIframeAndWait = (iframe, fields) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('iframe の読み込みがタイムアウトしました。'));
    }, 15000);
    iframe.addEventListener(
      'load',
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );
    post('index.php', fields, iframe.name);
  });

const collectHolidayDates = (baseUseDate) => {
  const baseYear = Number(baseUseDate.slice(0, 4));
  const baseMonth = Number(baseUseDate.slice(4, 6));
  const targetMonth = baseMonth === 12 ? 1 : baseMonth + 1;
  const targetYear = baseMonth === 12 ? baseYear + 1 : baseYear;
  const holidays = [];
  const usedDates = new Set();
  const dayCells = document.querySelectorAll(
    'td.day-name.bg-saturday-2, td.day-name.bg-sunday-2',
  );

  for (const dayCell of dayCells) {
    const text = dayCell.textContent.replace(/\s+/g, ' ').trim();
    const mdMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (!mdMatch) continue;
    const month = Number(mdMatch[1]);
    const day = Number(mdMatch[2]);
    if (month !== targetMonth) continue;
    const year = targetYear;
    const yyyymmdd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    if (usedDates.has(yyyymmdd)) continue;
    usedDates.add(yyyymmdd);

    const labelMatch = text.match(/\d{1,2}\/\d{1,2}\s*\([^)]+\)/);
    const label = labelMatch ? labelMatch[0] : `${month}/${day}`;
    holidays.push({ yyyymmdd, label });
  }

  return holidays;
};

const collectTimeRangesFromFacilityPage = () => {
  const useDate = document.getElementsByName('UseDate')[0]?.value;
  if (!YMD_PATTERN.test(useDate ?? '')) return {};

  let slotContext = { hours: null, halfHourWidth: null };
  const byDate = {};
  for (const table of document.querySelectorAll('table.koma-table')) {
    slotContext = {
      hours: readHeaderHours(table) ?? slotContext.hours,
      halfHourWidth: readHalfHourWidth(table) ?? slotContext.halfHourWidth,
    };
    if (!slotContext.hours || !Number.isFinite(slotContext.halfHourWidth)) continue;

    for (const row of table.querySelectorAll('tr')) {
      const tds = [...row.querySelectorAll('td')];
      if (tds.length < 2 || !tds[0].classList.contains('name')) continue;
      const ranges = collectTimeRangesFromSlotCells(
        tds.slice(1),
        slotContext.hours[0],
        slotContext.halfHourWidth,
      );
      if (ranges.length > 0 && !byDate[useDate]) {
        byDate[useDate] = ranges;
      }
    }
  }

  return byDate;
};

const collectTimeRangesFromPeriodPage = () => {
  const useDate = document.getElementsByName('UseDate')[0]?.value;
  if (!YMD_PATTERN.test(useDate ?? '')) return {};

  const baseYear = Number(useDate.slice(0, 4));
  const baseMonth = Number(useDate.slice(4, 6));
  let slotContext = { hours: null, halfHourWidth: null };
  const byDate = {};

  for (const table of document.querySelectorAll('table.koma-table')) {
    slotContext = {
      hours: readHeaderHours(table) ?? slotContext.hours,
      halfHourWidth: readHalfHourWidth(table) ?? slotContext.halfHourWidth,
    };
    if (!slotContext.hours || !Number.isFinite(slotContext.halfHourWidth)) continue;

    for (const row of table.querySelectorAll('tr')) {
      const dayCell = row.querySelector('td.day-name');
      if (!dayCell) continue;
      const allCells = [...row.querySelectorAll('td')];
      if (allCells.length < 2) continue;

      const mdMatch = dayCell.textContent.match(/(\d{1,2})\/(\d{1,2})/);
      if (!mdMatch) {
        throw new Error(
          `day-name から日付を抽出できません: "${dayCell.textContent.trim()}"`,
        );
      }
      const month = Number(mdMatch[1]);
      const day = Number(mdMatch[2]);
      const year = month < baseMonth ? baseYear + 1 : baseYear;
      const date = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;

      const ranges = collectTimeRangesFromSlotCells(
        allCells.slice(1),
        slotContext.hours[0],
        slotContext.halfHourWidth,
      );
      if (ranges.length > 0 && !byDate[date]) {
        byDate[date] = ranges;
      }
    }
  }

  return byDate;
};

const collectTimeRangesByDateFromCurrentPage = () => {
  const h2Text = getCurrentH2Text();
  if (isPeriodPage(h2Text)) return collectTimeRangesFromPeriodPage();
  if (h2Text.startsWith('施設の空き状況 ::')) return collectTimeRangesFromFacilityPage();
  return {};
};

const isMonthEndUseDate = (useDate) => {
  if (!/^\d{8}$/.test(useDate ?? '')) return false;
  const year = Number(useDate.slice(0, 4));
  const month = Number(useDate.slice(4, 6));
  const day = Number(useDate.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }
  const lastDay = new Date(year, month, 0).getDate();
  return day === lastDay;
};

const resolveMonthEndUseDate = (useDate) => {
  let baseDate = null;
  if (/^\d{8}$/.test(useDate ?? '')) {
    const y = Number(useDate.slice(0, 4));
    const m = Number(useDate.slice(4, 6));
    const d = Number(useDate.slice(6, 8));
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      baseDate = new Date(y, m - 1, d);
    }
  }
  if (!baseDate || Number.isNaN(baseDate.getTime())) {
    baseDate = new Date();
  }
  const endOfMonthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  return `${endOfMonthDate.getFullYear()}${String(endOfMonthDate.getMonth() + 1).padStart(
    2,
    '0',
  )}${String(endOfMonthDate.getDate()).padStart(2, '0')}`;
};

const annotateHolidayTable = (table, yyyymmdd, fallbackContext) => {
  let hours = readHeaderHours(table) ?? fallbackContext.hours;
  if (!hours) hours = [];
  const firstHour = hours[0];
  const halfHourWidth = readHalfHourWidth(table) ?? fallbackContext.halfHourWidth;

  for (const element of table.querySelectorAll('*')) {
    for (const attr of [...element.attributes]) {
      if (attr.name.startsWith('on')) {
        element.removeAttribute(attr.name);
      }
    }
  }

  const rows = [...table.querySelectorAll('tr')];
  for (const row of rows) {
    const tds = [...row.querySelectorAll('td')];
    if (tds.length < 2) continue;

    const shitsujo = parseShitsujoFromRow(row);
    if (!shitsujo) continue;
    if (!Number.isFinite(firstHour) || !Number.isFinite(halfHourWidth)) continue;

    const timeRanges = [];
    let cursorHalfHour = firstHour * 2;
    let slotIndex = 0;
    for (let i = 1; i < tds.length; i++) {
      const cell = tds[i];
      const widthMatch = cell.getAttribute('style')?.match(/width:\s*([\d.]+)px/);
      const widthPx = widthMatch ? Number(widthMatch[1]) : null;
      const halfHourUnits =
        Number.isFinite(widthPx) && halfHourWidth > 0
          ? Math.max(1, Math.round(widthPx / halfHourWidth))
          : Math.max(1, 2 * (Number(cell.colSpan) || 1));
      const fromTotalMinutes = cursorHalfHour * 30;
      const toTotalMinutes = (cursorHalfHour + halfHourUnits) * 30;
      const fromClock = `${String(Math.floor(fromTotalMinutes / 60)).padStart(2, '0')}${String(
        fromTotalMinutes % 60,
      ).padStart(2, '0')}`;
      const toClock = `${String(Math.floor(toTotalMinutes / 60)).padStart(2, '0')}${String(
        toTotalMinutes % 60,
      ).padStart(2, '0')}`;
      const timeRange = `${fromClock}${toClock}`;
      const isSlotCell = halfHourUnits >= 2;
      if (isSlotCell) {
        cell.dataset.slotDate = yyyymmdd;
        cell.dataset.slotShitsujo = shitsujo;
        cell.dataset.slotRange = timeRange;
        cell.dataset.slotIndex = String(slotIndex);
        cell.style.cursor = 'pointer';
        cell.title = `${yyyymmdd} ${timeRange} ${shitsujo}`;
        cell.addEventListener('click', () => {
          const slot = [yyyymmdd, timeRange, shitsujo];
          const key = getSlotKey(slot[0], slot[1], slot[2]);
          setSlotSelected(slot, !selectedSlotMap.has(key));
        });
        timeRanges.push(timeRange);
        slotIndex += 1;
      }
      cursorHalfHour += halfHourUnits;
    }
    if (timeRanges.length > 0 && !timeRangesByDate.has(yyyymmdd)) {
      timeRangesByDate.set(yyyymmdd, timeRanges);
    }
  }

  return { hours, halfHourWidth };
};

const createHiddenWorkIframe = () => {
  let iframe = document.getElementById('adachi-yoyaku-assist-iframe');
  if (iframe) iframe.remove();
  iframe = document.createElement('iframe');
  iframe.id = 'adachi-yoyaku-assist-iframe';
  iframe.name = `adachiYoyakuAssistFrame_${Date.now()}`;
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  return iframe;
};

const appendHolidayTablesFromIframe = (iframe, holiday, selectCalendar) => {
  const tables = [...iframe.contentDocument.querySelectorAll('table.koma-table')];
  let replacedHeader = false;
  let slotContext = { hours: [], halfHourWidth: null };
  for (const table of tables) {
    const cloned = table.cloneNode(true);
    const firstTh = cloned.querySelector('th');
    if (firstTh && firstTh.textContent.trim() === '施設') {
      if (replacedHeader) continue;
      firstTh.textContent = holiday.label;
      replacedHeader = true;
    }
    slotContext = annotateHolidayTable(cloned, holiday.yyyymmdd, slotContext);
    selectCalendar.appendChild(cloned);
  }
};

const processHolidayButton = async () => {
  const isPeriodScreen = isPeriodPage();
  const useDate = document.getElementsByName('UseDate')[0]?.value;
  if (!isPeriodScreen || !isMonthEndUseDate(useDate)) {
    const monthEndUseDate = resolveMonthEndUseDate(useDate);
    sessionStorage.setItem(AUTO_RUN_HOLIDAY_KEY, '1');
    post('index.php', buildPeriodSearchFields(monthEndUseDate));
    return;
  }

  const selectCalendar = document.querySelector('.SelectCalendar');
  if (!selectCalendar) {
    alert('`.SelectCalendar` が見つかりません。');
    return;
  }

  const holidays = collectHolidayDates(useDate);
  if (holidays.length === 0) {
    alert('休日が見つかりませんでした。');
    return;
  }

  selectedSlotMap.clear();
  timeRangesByDate.clear();
  renderRequestRunner();
  selectCalendar.replaceChildren();

  const iframe = createHiddenWorkIframe();

  try {
    for (const holiday of holidays) {
      await postToIframeAndWait(iframe, [
        ['op', 'srch_sst'],
        ['UseDate', holiday.yyyymmdd],
        ['ShisetsuCode', SHISETSU_CODE],
        ['disp_span', '0'],
      ]);
      appendHolidayTablesFromIframe(iframe, holiday, selectCalendar);
    }
    await saveTimeRangesByDateToStorage();
  } catch (error) {
    alert(`休日データの取得に失敗しました: ${error.message}`);
  }
};

const buildPeriodSearchFields = (useDate) => [
  ['op', 'srch_stj'],
  ['UseDate', useDate],
  ['ShisetsuCode', SHISETSU_CODE],
  ['scd', SHISETSU_CODE],
  ['StjCmbCode', SHITSUJO_CODES.A],
  ['disp_span', '0'],
];

const styleMenuButton = (button, variant = 'default') => {
  button.style.display = 'inline-flex';
  button.style.boxSizing = 'border-box';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.width = '100%';
  button.style.minHeight = '34px';
  button.style.padding = '7px 10px';
  button.style.borderRadius = '7px';
  button.style.border = '1px solid #8f98a3';
  button.style.fontSize = '13px';
  button.style.fontWeight = '700';
  button.style.letterSpacing = '0.02em';
  button.style.cursor = 'pointer';
  button.style.userSelect = 'none';
  button.style.transition =
    'background-color .12s ease, transform .04s ease, box-shadow .12s ease';
  button.style.boxShadow = '0 1px 2px rgba(0,0,0,.12)';
  if (variant === 'primary') {
    button.style.background = '#1f6feb';
    button.style.borderColor = '#1f6feb';
    button.style.color = '#fff';
  } else {
    button.style.background = '#ffffff';
    button.style.color = '#1f2937';
  }
  button.addEventListener('mouseenter', () => {
    if (button.disabled) return;
    button.style.background = variant === 'primary' ? '#175fcc' : '#f3f5f7';
    button.style.boxShadow = '0 2px 6px rgba(0,0,0,.18)';
  });
  button.addEventListener('mouseleave', () => {
    if (button.disabled) return;
    button.style.background = variant === 'primary' ? '#1f6feb' : '#ffffff';
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = '0 1px 2px rgba(0,0,0,.12)';
  });
  button.addEventListener('mousedown', () => {
    if (button.disabled) return;
    button.style.transform = 'translateY(1px)';
  });
  button.addEventListener('mouseup', () => {
    if (button.disabled) return;
    button.style.transform = 'translateY(0)';
  });
};

const createPeriodButton = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '来月の空き状況';
  styleMenuButton(button);
  button.addEventListener('click', () => {
    const now = new Date();
    const endOfMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const useDate = `${endOfMonthDate.getFullYear()}${String(
      endOfMonthDate.getMonth() + 1,
    ).padStart(2, '0')}${String(endOfMonthDate.getDate()).padStart(2, '0')}`;
    post('index.php', buildPeriodSearchFields(useDate));
  });
  return button;
};

const createHolidayButton = () => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '休日の空き状況';
  styleMenuButton(button);
  button.addEventListener('click', () => {
    void processHolidayButton();
  });
  return button;
};

const createRunRequestButton = () => {
  runRequestButton = document.createElement('button');
  runRequestButton.type = 'button';
  runRequestButton.textContent = '申込トレイに入れる';
  runRequestButton.disabled = true;
  styleMenuButton(runRequestButton, 'primary');
  runRequestButton.style.opacity = '0.55';
  runRequestButton.style.cursor = 'not-allowed';
  runRequestButton.addEventListener('click', () => {
    const slots = getSelectedSlots();
    void request(slots);
  });
  return runRequestButton;
};

const createRequestCodeBlock = () => {
  requestCodeBlock = document.createElement('pre');
  requestCodeBlock.style.boxSizing = 'border-box';
  requestCodeBlock.style.margin = '0';
  requestCodeBlock.style.padding = '6px';
  requestCodeBlock.style.border = '1px solid #ddd';
  requestCodeBlock.style.background = '#f7f7f7';
  requestCodeBlock.style.fontSize = '11px';
  requestCodeBlock.style.lineHeight = '1.4';
  requestCodeBlock.style.maxHeight = '180px';
  requestCodeBlock.style.overflow = 'auto';
  return requestCodeBlock;
};

const addFloatingMenu = () => {
  if (document.getElementById('adachi-yoyaku-assist-menu')) return;
  ensureAssistStyle();

  const wrap = document.createElement('div');
  wrap.id = 'adachi-yoyaku-assist-menu';
  wrap.style.position = 'fixed';
  wrap.style.left = '12px';
  wrap.style.bottom = '12px';
  wrap.style.zIndex = '99999';
  wrap.style.display = 'grid';
  wrap.style.gap = '6px';
  wrap.style.padding = '8px';
  wrap.style.border = '1px solid #999';
  wrap.style.borderRadius = '8px';
  wrap.style.background = '#fff';
  wrap.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
  wrap.style.minWidth = '280px';
  wrap.style.fontFamily = '"Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
  wrap.appendChild(createPeriodButton());
  wrap.appendChild(createHolidayButton());
  wrap.appendChild(createRunRequestButton());
  wrap.appendChild(createRequestCodeBlock());
  if (!document.body) return;
  document.body.appendChild(wrap);
  renderRequestRunner();
};

const init = () => {
  addFloatingMenu();

  const currentRanges = collectTimeRangesByDateFromCurrentPage();
  mergeTimeRangesByDate(currentRanges);
  if (Object.keys(currentRanges).length > 0) {
    void saveTimeRangesByDateToStorage();
  }

  const h2Text = getCurrentH2Text();
  if (h2Text.startsWith('申込トレイ ::')) {
    process申込トレイ();
  } else if (h2Text.startsWith('申込情報入力 ::')) {
    process申込情報入力();
  }

  if (sessionStorage.getItem(AUTO_RUN_HOLIDAY_KEY) === '1' && isPeriodPage(h2Text)) {
    sessionStorage.removeItem(AUTO_RUN_HOLIDAY_KEY);
    void processHolidayButton();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
