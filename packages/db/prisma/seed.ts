import { PrismaClient, JobStatus, Role } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const pm = await prisma.user.upsert({
    where: { email: 'pm@example.com' },
    update: {},
    create: { email: 'pm@example.com', name: 'Pat PM', role: Role.PM }
  });
  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: { email: 'alice@example.com', name: 'Alice (Part-Timer)', role: Role.PART_TIMER }
  });
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: { email: 'admin@example.com', name: 'Ari Admin', role: Role.ADMIN }
  });

  const now = new Date();
  const baseCall = new Date(now.getTime() + 60 * 60 * 1000); // +1h
  const mkJob = async (title: string, venue: string, jobType: string, callOffsetMin: number) => {
    const call = new Date(baseCall.getTime() + callOffsetMin * 60 * 1000);
    const end  = new Date(call.getTime() + 3 * 60 * 60 * 1000);
    return prisma.job.create({
      data: {
        title, venue,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        callTimeUtc: call,
        endTimeUtc: end,
        jobType,
        headcountTarget: 20,
        status: JobStatus.PUBLISHED,
        createdBy: pm.id,
        callGraceMins: 15,
        baseHourly: 12,
        minCallHours: 4,
        otAfterHours: 8,
        otMultiplier: 1.5,
        breakMinutes: 30,
        ownTransportAllowance: 10
      }
    });
  };

  await mkJob('Usher Team',    'Main Entrance', 'Usher',    0);
  await mkJob('Catering Team', 'Banquet Hall',  'Catering', 60);
  await mkJob('Security Team', 'Gate B',        'Security', 120);
  await mkJob('Setup Team',    'Hall A',        'Setup',    180);

  console.log('Seeded users & jobs:', { pm: pm.email, alice: alice.email, admin: admin.email });
}

main().catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
