'use strict';
const prisma = require('../../src/config/db');

let tables = null;
/** Empty every table (FK checks off). Only ever called on the test DB. */
const resetDb = async () => {
  if (!tables) {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
    );
    tables = rows.map(r => r.t || r.TABLE_NAME).filter(t => !t.startsWith('_prisma'));
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM \`${t}\``);
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
};

module.exports = { prisma, resetDb };
