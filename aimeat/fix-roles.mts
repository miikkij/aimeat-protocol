import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
await p.owner.update({ where: { name: 'happyadmin' }, data: { roles: ['owner', 'operator'] } });
console.log('Roles set:', (await p.owner.findUnique({ where: { name: 'happyadmin' } }))?.roles);
await p.$disconnect();
