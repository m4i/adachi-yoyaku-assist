(() => {
  const TargetSlots = [1, 2]; // 1: 8:00-10:00, 2: 10:00-12:00

  switch (location.pathname) {
    // 「予約申込画面」
    case '/web/rsvWTransInstSrchVacantAction.do':
      document.querySelector('img[alt="利用目的から"]').click();
      break;

    // 「利用目的選択画面」
    case '/web/rsvWTransInstSrchPpsdAction.do':
      [...document.querySelectorAll('.tcontent a')]
        .find((el) => el.textContent === '少年軟式野球')
        .click();
      break;

    // 「館選択画面」
    case '/web/rsvWTransInstSrchBuildAction.do':
      [...document.querySelectorAll('.tcontent a')]
        .find((el) => el.textContent === '西新井橋野球場')
        .click();
      break;

    // 「施設空き状況画面時間貸し」時間選択前
    case '/web/rsvWInstSrchVacantWAllAction.do':
      const trs = [...document.querySelectorAll('table.akitablelist tr')].slice(1);
      const courts = trs.map((tr) => {
        const tds = [...tr.querySelectorAll('td')];
        return tds.flatMap((td) => {
          const img = td.querySelector('img');
          const vacancy = img.alt === '空き';
          return new Array(parseInt(td.colSpan) / 24).fill(vacancy ? img : null);
        });
      });
      console.log(courts);
      for (const court of courts.reverse()) {
        if (TargetSlots.every((slot) => court[slot])) {
          court[TargetSlots[0]].click();
          break;
        }
      }
      break;

    // 「時間貸し利用開始時間選択画面」
    case '/web/rsvWInstRsvSetStimeWAllAction.do':
      const startTime = `${String(6 + TargetSlots[0] * 2).padStart(2, '0')}時00分`;
      [...document.querySelectorAll('.tcontent a')]
        .find((el) => el.textContent === startTime)
        .click();
      break;

    // 「時間貸し利用終了時間選択画面」
    case '/web/rsvWInstRsvSetEtimeWAllAction.do':
      const endTime = `${String(8 + TargetSlots[1] * 2).padStart(2, '0')}時00分`;
      [...document.querySelectorAll('.tcontent a')]
        .find((el) => el.textContent === endTime)
        .click();
      break;

    // 「施設空き状況画面時間貸し」時間選択後
    case '/web/rsvWInstSrchVacantTimeSelectionWAllAction.do':
      document.querySelector('img[alt="申込み"]').click();
      break;

    // 「予約内容一覧画面」
    case '/web/rsvWInstTempRsvApplyAction.do':
      [...document.getElementsByName('applyNum')].forEach((el) => (el.value = '20'));
      document.querySelector('img[alt="申込み"]').click();
      break;
  }
})();
