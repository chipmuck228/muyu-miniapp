// 农历日期：借 Intl 的中国历（iOS / 新版安卓都有）。拿不到或格式不认识就返回 null，界面上不显示
export interface LunarDay {
  /** 丙午 */
  yearName: string
  /** 九月 / 闰四月 / 腊月 */
  month: string
  /** 初一 / 十五 / 廿三 */
  day: string
  dayNum: number
  /** 春节、中秋这些；没有为空 */
  festival: string
}

const DAY_CN = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十']
const TENS = ['', '十', '廿', '三十']
const DIGIT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

function dayName(n: number): string {
  if (n <= 10) return DAY_CN[n]
  if (n === 20) return '二十'
  if (n === 30) return '三十'
  return TENS[Math.floor(n / 10)] + DIGIT[n % 10]
}

const FESTIVALS: Record<string, string> = {
  '正月-1': '春节',
  '正月-15': '元宵',
  '五月-5': '端午',
  '七月-7': '七夕',
  '八月-15': '中秋',
  '九月-9': '重阳',
  '腊月-8': '腊八',
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 引擎直接给了「廿三」这样的写法时，换回数字 */
function parseCnDay(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (s === '二十') return 20
  if (s === '三十') return 30
  if (s.indexOf('初') === 0) return CN_NUM[s.slice(1)] || 0
  if (s.indexOf('廿') === 0) return 20 + (CN_NUM[s.slice(1)] || 0)
  if (s.indexOf('十') === 0) return 10 + (CN_NUM[s.slice(1)] || 0)
  return 0
}

let cache: { key: string; value: LunarDay | null } | null = null

export function lunarOf(date: Date): LunarDay | null {
  const key = date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate()
  if (cache && cache.key === key) return cache.value
  let value: LunarDay | null = null
  try {
    const I: any = typeof Intl === 'undefined' ? null : Intl
    if (I && typeof I.DateTimeFormat === 'function') {
      const md = new I.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
      const yf = new I.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric' })
      let month = ''
      let dayRaw = ''
      if (typeof md.formatToParts === 'function') {
        md.formatToParts(date).forEach((p: any) => {
          if (p.type === 'month') month = p.value
          if (p.type === 'day') dayRaw = p.value
        })
      } else {
        const m = /^(闰?[正一二三四五六七八九十冬腊]+月)(.+?)日?$/.exec(md.format(date))
        if (m) {
          month = m[1]
          dayRaw = m[2]
        }
      }
      let yearName = ''
      const ym = /([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])/.exec(yf.format(date))
      if (ym) yearName = ym[1]
      const n = parseCnDay(dayRaw)
      if (/^闰?[正一二三四五六七八九十冬腊]+月$/.test(month) && n >= 1 && n <= 30) {
        value = {
          yearName,
          month,
          day: dayName(n),
          dayNum: n,
          festival: FESTIVALS[month + '-' + n] || '',
        }
      }
    }
  } catch {
    value = null
  }
  cache = { key, value }
  return value
}

/** 清晨 / 上午 / 正午 / 午后 / 黄昏 / 夜里 / 深夜 */
export function timeOfDay(d: Date): string {
  const h = d.getHours()
  if (h >= 5 && h < 9) return '清晨'
  if (h >= 9 && h < 12) return '上午'
  if (h >= 12 && h < 14) return '正午'
  if (h >= 14 && h < 17) return '午后'
  if (h >= 17 && h < 19) return '黄昏'
  if (h >= 19 && h < 23) return '夜里'
  return '深夜'
}

/** 入堂页底下那行小字：丙午年 九月廿三 · 黄昏；逢初一十五、节日另说一句 */
export function gateLine(d: Date): string {
  const tod = timeOfDay(d)
  const l = lunarOf(d)
  if (!l) return tod
  const head = (l.yearName ? l.yearName + '年 ' : '') + l.month + l.day
  if (l.festival) return head + ' · ' + l.festival
  if (l.dayNum === 1 || l.dayNum === 15) return head + ' · 宜静心'
  return head + ' · ' + tod
}
