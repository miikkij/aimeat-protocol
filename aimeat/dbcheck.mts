import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const o = await p.owner.findUnique({ where: { name: 'happyadmin' } });
console.log('roles:', JSON.stringify(o?.roles));
const all = await p.owner.findMany({ select: { name: true, roles: true }, orderBy: { createdAt: 'asc' }, take: 5 });
console.log('first 5 owners:', JSON.stringify(all));
await p.$disconnect();
