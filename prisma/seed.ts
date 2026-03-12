import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.room.upsert({
    where: { code: 'DEMO01' },
    update: {},
    create: {
      code: 'DEMO01',
      status: 'ACTIVE',
    },
  })
}

main()
  .catch((error) => {
    console.error('Seed failed', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
