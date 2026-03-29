const fs = require('fs');
const path = 'lib/consensus-engine.ts';
let s = fs.readFileSync(path, 'utf8');
s = s.replace(
  "import { getExpertHitRates30d } from '@/lib/db/expert-accuracy';",
  "import { getExpertHitRates30d, getExpertHitRates7d } from '@/lib/db/expert-accuracy';"
);
const cohesionNeedle = `  const cohesion = await evaluateSystemCohesionAsync({
    tech_score: expert1.tech_score,
    risk_score: expert2.risk_score,
    psych_score: expert3.psych_score,
  });`;
const cohesionRepl = `  let expert7: ExpertContrarianOutput = {
    contrarian_confidence: 0,
    trap_type: 'none',
    trap_hypothesis_he: '',
    attack_on_consensus_he: '',
  };
  try {
    const avgBoard =
      (expert1.tech_score +
        expert2.risk_score +
        expert3.psych_score +
        expert4.macro_score +
        expert5.onchain_score +
        expert6.deep_memory_score) /
      6;
    const boardLean = scoreToDirection(avgBoard);
    expert7 = await runExpertContrarian(
      fullInput,
      {
        tech: expert1,
        risk: expert2,
        psych: expert3,
        macro: expert4,
        onchain: expert5,
        deep: expert6,
        boardLean,
        avgScore: avgBoard,
      },
      getContrarianGeminiModelId(),
      timeoutMs
    );
  } catch (cErr) {
    console.warn('[ConsensusEngine] Contrarian failed:', cErr instanceof Error ? cErr.message : cErr);
  }

  const cohesion = await evaluateSystemCohesionAsync({
    tech_score: expert1.tech_score,
    risk_score: expert2.risk_score,
    psych_score: expert3.psych_score,
  });`;
if (!s.includes(cohesionNeedle)) throw new Error('cohesion');
s = s.replace(cohesionNeedle, cohesionRepl);
const judgeTypeOld = `  let judgeResult: { master_insight_he: string; reasoning_path: string; debate_resolution: string };`;
const judgeTypeNew = `  let judgeResult: {
    master_insight_he: string;
    reasoning_path: string;
    debate_resolution: string;
    contrarian_addressed: boolean;
    contrarian_refutation_he: string;
  };`;
s = s.replace(judgeTypeOld, judgeTypeNew);
const callOld = `    judgeResult = await runJudge(
      expert1,
      expert2,
      expert3,
      expert4,
      expert5,
      expert6,
      input.symbol,
      model,
      timeoutMs,
      { polarizedBoard, expertHitRatesLine }
    );`;
const callNew = `    judgeResult = await runJudge(
      expert1,
      expert2,
      expert3,
      expert4,
      expert5,
      expert6,
      expert7,
      input.symbol,
      model,
      timeoutMs,
      { polarizedBoard, expertHitRatesLine }
    );`;
s = s.replace(callOld, callNew);
const fbOld = `    judgeResult = {
      master_insight_he: 'תובנת קונצנזוס לא זמינה (שגיאה בשופט). המערכת משתמשת בציוני ששת המומחים בלבד.',
      reasoning_path: 'שופט לא זמין — חישוב ציון סופי לפי משקלים בלבד.',
      debate_resolution: '',
    };`;
const fbNew = `    judgeResult = {
      master_insight_he: 'תובנת קונצנזוס לא זמינה (שגיאה בשופט). המערכת משתמשת בציוני ששת המומחים בלבד.',
      reasoning_path: 'שופט לא זמין — חישוב ציון סופי לפי משקלים בלבד.',
      debate_resolution: '',
      contrarian_addressed: false,
      contrarian_refutation_he: '',
    };`;
s = s.replace(fbOld, fbNew);
const hrNeedle = `  const expertHitRatesLine = \`טכני=\${hitRates.technician}%, סיכון=\${hitRates.risk}%, פסיכ=\${hitRates.psych}%, מקרו=\${hitRates.macro}%, on-chain=\${hitRates.onchain}%, DeepMemory=\${hitRates.deepMemory}%.\`;`;
const hrRepl = `  const hitRates7d = await getExpertHitRates7d({ symbol: normalizedForHits }).catch(() => hitRates);
  const expertHitRatesLine = \`טכני=\${hitRates.technician}%, סיכון=\${hitRates.risk}%, פסיכ=\${hitRates.psych}%, מקרו=\${hitRates.macro}%, on-chain=\${hitRates.onchain}%, DeepMemory=\${hitRates.deepMemory}%.\`;
  const decay7d = (k) => (hitRates7d[k] < 55 ? 0.5 : 1);`;
if (!s.includes('const expertHitRatesLine = `טכני=')) throw new Error('hr');
s = s.replace(hrNeedle, hrRepl);
fs.writeFileSync(path, s);
console.log('cohesion judge decay line ok');