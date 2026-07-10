const STATE_CODE: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

const BY_STATE: Record<string, string[]> = {
  Alabama: ["205","251","256","334","659","938"],
  Alaska: ["907"],
  Arizona: ["480","520","602","623","928"],
  Arkansas: ["479","501","870"],
  California: ["209","213","279","310","323","341","350","408","415","424","442","510","530","559","562","619","626","628","650","657","661","669","707","714","747","760","805","818","820","831","840","858","909","916","925","949","951"],
  Colorado: ["303","719","720","970","983"],
  Connecticut: ["203","475","860","959"],
  Delaware: ["302"],
  "District of Columbia": ["202","771"],
  Florida: ["239","305","321","352","386","407","448","561","645","656","689","727","754","772","786","813","850","863","904","941","954"],
  Georgia: ["229","404","470","478","678","706","762","770","912","943"],
  Hawaii: ["808"],
  Idaho: ["208","986"],
  Illinois: ["217","224","309","312","331","447","464","618","630","708","730","773","779","815","847","872"],
  Indiana: ["219","260","317","463","574","765","812","930"],
  Iowa: ["319","515","563","641","712"],
  Kansas: ["316","620","785","913"],
  Kentucky: ["270","364","502","606","859"],
  Louisiana: ["225","318","337","504","985"],
  Maine: ["207"],
  Maryland: ["227","240","301","410","443","667"],
  Massachusetts: ["339","351","413","508","617","774","781","857","978"],
  Michigan: ["231","248","269","313","517","586","616","679","734","810","906","947","989"],
  Minnesota: ["218","320","507","612","651","763","924","952"],
  Mississippi: ["228","601","662","769"],
  Missouri: ["314","417","557","573","636","660","816","975"],
  Montana: ["406"],
  Nebraska: ["308","402","531"],
  Nevada: ["702","725","775"],
  "New Hampshire": ["603"],
  "New Jersey": ["201","551","609","640","732","848","856","862","908","973"],
  "New Mexico": ["505","575"],
  "New York": ["212","315","329","332","347","363","516","518","585","607","631","646","680","716","718","838","845","914","917","929","934"],
  "North Carolina": ["252","336","704","743","828","910","919","980","984"],
  "North Dakota": ["701"],
  Ohio: ["216","220","234","283","326","330","380","419","436","440","513","567","614","740","937"],
  Oklahoma: ["405","539","572","580","918"],
  Oregon: ["458","503","541","971"],
  Pennsylvania: ["215","223","267","272","412","445","484","570","582","610","717","724","814","835","878"],
  "Rhode Island": ["401"],
  "South Carolina": ["803","821","839","843","854","864"],
  "South Dakota": ["605"],
  Tennessee: ["423","615","629","731","865","901","931"],
  Texas: ["210","214","254","281","325","346","361","409","430","432","469","512","682","713","726","737","806","817","830","832","903","915","936","940","945","956","972","979"],
  Utah: ["385","435","801"],
  Vermont: ["802"],
  Virginia: ["276","434","540","571","686","703","757","804","826","948"],
  Washington: ["206","253","360","425","509","564"],
  "West Virginia": ["304","681"],
  Wisconsin: ["262","274","353","414","534","608","715","920"],
  Wyoming: ["307"],
};

export const AREA_CODE_STATE: Record<string, { state: string; stateCode: string }> = {};
for (const [state, codes] of Object.entries(BY_STATE)) {
  for (const code of codes) AREA_CODE_STATE[code] = { state, stateCode: STATE_CODE[state] };
}

export function areaCodeOf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 10 ? d.slice(0, 3) : null;
}

export function stateOfPhone(phone: string | null | undefined): { state: string; stateCode: string } | null {
  const ac = areaCodeOf(phone);
  return ac ? AREA_CODE_STATE[ac] ?? null : null;
}
