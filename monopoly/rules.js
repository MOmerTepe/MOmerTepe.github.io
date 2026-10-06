// Every player receives the same validated rules when the host starts the game.
export const DEFAULT_RULES = Object.freeze({
  startingCash:1500, salary:200, bail:50, rentMultiplier:1,
  auctions:true, freeParkingPot:false, doubleSalaryOnGo:false, evenBuilding:true,
});

export const RULE_PRESETS = Object.freeze({
  classic:DEFAULT_RULES,
  quick:Object.freeze({...DEFAULT_RULES,startingCash:1000,salary:100,rentMultiplier:1.5}),
  generous:Object.freeze({...DEFAULT_RULES,startingCash:2500,salary:300,bail:25,freeParkingPot:true,doubleSalaryOnGo:true}),
});

const choices = {
  startingCash:[500,1000,1500,2000,2500,3000,5000],
  salary:[0,100,200,300,400,500],
  bail:[0,25,50,100,200],
  rentMultiplier:[0.5,1,1.5,2],
};

export function normalizeRules(options={}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Choose a valid rules configuration.');
  for (const key of Object.keys(options)) {
    if (!Object.hasOwn(DEFAULT_RULES,key)) throw new Error(`Unknown rule: ${key}.`);
  }
  const rules = {...DEFAULT_RULES,...options};
  for (const [key,value] of Object.entries(rules)) {
    if (choices[key]) {
      if (!choices[key].includes(value)) throw new Error(`Invalid ${key}: choose one of ${choices[key].join(', ')}.`);
    } else if (typeof value !== 'boolean') throw new Error(`Invalid ${key}: use true or false.`);
  }
  return rules;
}
