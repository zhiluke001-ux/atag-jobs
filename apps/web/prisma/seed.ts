// apps/web/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Create a dummy user (optional)
  const user = await prisma.user.upsert({
    where: { email: 'demo@atag.jobs' },
    update: {},
    create: { email: 'demo@atag.jobs' },
  });

  // Create one published future job
  const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const inFiveHours = new Date(Date.now() + 5 * 60 * 60 * 1000);

  await prisma.job.create({
    data: {
      title: 'Event Crew (Registration)',
      venue: 'KLCC Hall A',
      callTimeUtc: inTwoHours.toISOString(),
      endTimeUtc: inFiveHours.toISOString(),
      status: 'PUBLISHED',
      createdById: user.id,
    },
  });

  console.log('Seeded one job.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
