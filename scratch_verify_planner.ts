import fs from 'fs';
import path from 'path';
import { plannerService } from './src/lib/services/planner.service';

// Load .env manually
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index !== -1) {
      const key = trimmed.substring(0, index).trim();
      const val = trimmed.substring(index + 1).trim();
      process.env[key] = val;
    }
  });
}

const userId = '5a7a6420-76ea-45c5-aff5-ec36e1000a76';
const groupId = 'ce6c553d-70c4-49ff-8e0e-877258e424b6';

async function testGeneration() {
  try {
    console.log('Starting itinerary generation with real Groq configuration...');
    // Clear API configurations so it runs local SQLite flow
    process.env.HANGOUT_API_URL = '';
    process.env.HANGOUT_API_SECRET = '';

    console.log('Using GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'CONFIGURED (length: ' + process.env.GROQ_API_KEY.length + ')' : 'MISSING');

    const res = await plannerService.generatePlan(userId, groupId);
    console.log('SUCCESS!');
    console.log('Generated plans count:', res.plans.length);
    console.log('First Plan Details:');
    console.log('- Name:', res.plans[0]?.name);
    console.log('- Tagline:', res.plans[0]?.tagline);
    console.log('- Meetup Zone:', res.plans[0]?.meetupZone);
    console.log('- Slots count:', res.plans[0]?.slots?.length);
    if (res.plans[0]?.slots && res.plans[0].slots.length > 0) {
      console.log('  Slots:');
      res.plans[0].slots.forEach(s => {
        console.log(`    * [${s.category}] ${s.name}`);
      });
    }
  } catch (err) {
    console.error('Plan generation failed:', err);
  }
}

testGeneration();
