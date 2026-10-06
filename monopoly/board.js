// Original Istanbul-inspired names, laid out on a familiar forty-space circuit.
export const GROUPS = Object.freeze({
  oldtown: { name: 'Old Town', color: '#965f46', spaces: [1, 3] },
  goldenhorn: { name: 'Golden Horn', color: '#7fc9dc', spaces: [6, 8, 9] },
  pera: { name: 'Pera', color: '#c269b5', spaces: [11, 13, 14] },
  neighbourhoods: { name: 'Neighbourhoods', color: '#e29b4e', spaces: [16, 18, 19] },
  asiancoast: { name: 'Asian Coast', color: '#d85d62', spaces: [21, 23, 24] },
  bosphorus: { name: 'Bosphorus', color: '#d8c761', spaces: [26, 27, 29] },
  northernshore: { name: 'Northern Shore', color: '#67ad86', spaces: [31, 32, 34] },
  landmarks: { name: 'Landmarks', color: '#698ad3', spaces: [37, 39] },
});

const street = (name, group, price, rents, buildCost) => ({name,type:'property',group,color:GROUPS[group].color,price,rents,buildCost});
const station = name => ({name,type:'railroad',price:200,rents:[25,50,100,200],color:'#71808f'});
const utility = name => ({name,type:'utility',price:150,color:'#a5adb5'});
const square = (name,type,extra={}) => ({name,type,...extra});
export const BOARD = Object.freeze([
  square('START','go'),
  street('Balat','oldtown',60,[2,10,30,90,160,250],50),
  square('City Fund','community'),
  street('Fener','oldtown',60,[4,20,60,180,320,450],50),
  square('City Tax','tax',{amount:200}),
  station('Sirkeci Station'),
  street('Karaköy','goldenhorn',100,[6,30,90,270,400,550],50),
  square('Opportunity','chance'),
  street('Tophane','goldenhorn',100,[6,30,90,270,400,550],50),
  street('Galata','goldenhorn',120,[8,40,100,300,450,600],50),
  square('Just Visiting / Detour','jail'),
  street('Cihangir','pera',140,[10,50,150,450,625,750],100),
  utility('City Electricity'),
  street('Çukurcuma','pera',140,[10,50,150,450,625,750],100),
  street('Pera','pera',160,[12,60,180,500,700,900],100),
  station('Haydarpaşa Station'),
  street('Beşiktaş','neighbourhoods',180,[14,70,200,550,750,950],100),
  square('City Fund','community'),
  street('Nişantaşı','neighbourhoods',180,[14,70,200,550,750,950],100),
  street('Teşvikiye','neighbourhoods',200,[16,80,220,600,800,1000],100),
  square('Tea Break','parking'),
  street('Kadıköy','asiancoast',220,[18,90,250,700,875,1050],150),
  square('Opportunity','chance'),
  street('Moda','asiancoast',220,[18,90,250,700,875,1050],150),
  street('Fenerbahçe','asiancoast',240,[20,100,300,750,925,1100],150),
  station('Marmaray Station'),
  street('Üsküdar','bosphorus',260,[22,110,330,800,975,1150],150),
  street('Kuzguncuk','bosphorus',260,[22,110,330,800,975,1150],150),
  utility('City Water'),
  street('Beylerbeyi','bosphorus',280,[24,120,360,850,1025,1200],150),
  square('Take a Detour','goToJail'),
  street('Arnavutköy','northernshore',300,[26,130,390,900,1100,1275],200),
  street('Bebek','northernshore',300,[26,130,390,900,1100,1275],200),
  square('City Fund','community'),
  street('Emirgan','northernshore',320,[28,150,450,1000,1200,1400],200),
  station('Bosphorus Ferry'),
  square('Opportunity','chance'),
  street('Galata Tower','landmarks',350,[35,175,500,1100,1300,1500],200),
  square('Restoration Levy','tax',{amount:100}),
  street('Bosphorus Palace','landmarks',400,[50,200,600,1400,1700,2000],200),
].map((space,index) => Object.freeze({...space,index})));

export const OWNABLE_TYPES = ['property','railroad','utility'];
