'use strict';
// 'YYYY-MM-DD' of the app's calendar day (India by default). Daily limits
// reset at local midnight, not at UTC midnight (5:30 AM IST).
// APP_TZ_OFFSET_MIN = minutes east of UTC (IST = 330).
const appDate = (d = new Date()) => {
  const off = Number(process.env.APP_TZ_OFFSET_MIN ?? 330) * 60 * 1000;
  return new Date(d.getTime() + off).toISOString().slice(0, 10);
};
module.exports = { appDate };
