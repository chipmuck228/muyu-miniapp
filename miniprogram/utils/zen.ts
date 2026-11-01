// 今日一句：按日期取一句，同一天打开几次都是同一句
export interface ZenLine {
  text: string
  from: string
}

const LINES: ZenLine[] = [
  { text: '行到水穷处，坐看云起时', from: '王维' },
  { text: '人闲桂花落，夜静春山空', from: '王维' },
  { text: '采菊东篱下，悠然见南山', from: '陶渊明' },
  { text: '万物静观皆自得', from: '程颢' },
  { text: '非宁静无以致远', from: '诸葛亮' },
  { text: '知止而后有定，定而后能静', from: '《大学》' },
  { text: '千里之行，始于足下', from: '《老子》' },
  { text: '自胜者强', from: '《老子》' },
  { text: '不积跬步，无以至千里', from: '《荀子》' },
  { text: '宠辱不惊，看庭前花开花落', from: '《小窗幽记》' },
  { text: '去留无意，望天上云卷云舒', from: '《小窗幽记》' },
  { text: '若无闲事挂心头，便是人间好时节', from: '无门慧开' },
  { text: '春有百花秋有月，夏有凉风冬有雪', from: '无门慧开' },
  { text: '竹杖芒鞋轻胜马，一蓑烟雨任平生', from: '苏轼' },
  { text: '且将新火试新茶，诗酒趁年华', from: '苏轼' },
  { text: '此心安处是吾乡', from: '苏轼' },
  { text: '山中何事？松花酿酒，春水煎茶', from: '张可久' },
  { text: '晚来天欲雪，能饮一杯无', from: '白居易' },
  { text: '欲速则不达', from: '《论语》' },
  { text: '水滴石穿，绳锯木断', from: '罗大经' },
  { text: '一念放下，万般自在', from: '' },
  { text: '慢慢来，比较快', from: '' },
  { text: '心若不动，风又奈何', from: '' },
  { text: '日日是好日', from: '' },
  { text: '把心放在这一下上', from: '' },
  { text: '每一叩，都是回到此刻', from: '' },
  { text: '今天也辛苦了，敲一敲，放一放', from: '' },
  { text: '风来疏竹，风过而竹不留声', from: '《菜根谭》' },
  { text: '雁度寒潭，雁去而潭不留影', from: '《菜根谭》' },
  { text: '静坐常思己过，闲谈莫论人非', from: '' },
]

function hashDate(date: string): number {
  let h = 0
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0
  return h
}

/** date: YYYY-MM-DD */
export function zenOfDay(date: string): ZenLine {
  return LINES[hashDate(date) % LINES.length]
}
