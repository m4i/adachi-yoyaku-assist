chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url.startsWith('https://yoyakusystem.city.adachi.tokyo.jp/web/')) return;

  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['script.js'],
  });
});
