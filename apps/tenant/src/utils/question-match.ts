/**
 * 题目相似度：相似题推荐与重复题检测。
 *
 * 中文题干没有空格可分词，这里用**字符二元组（bigram）的 Jaccard 相似度**近似：
 * 「已知函数 f(x)=… 求单调区间」与「已知函数 f(x)=… 求单调递增区间」这类只差几个字的题
 * 会拿到很高的分，而换了知识点的题分数很低。对「提醒教师别把同一道题出两遍」这个用途，
 * 精度足够，且零依赖、可离线跑，不需要接任何 NLP 服务。
 */
import type { OrgQuestion } from '@aiteach/shared'
import { toPlainText } from '@aiteach/shared'

/** 去掉标点与空白：标点不携带语义，留着只会稀释 bigram 命中率 */
function normalize(text: string): string {
  return text.replace(/[\s，。、；：？！“”‘’「」『』（）()《》〈〉—…·,.!?;:'"[\]{}]/g, '')
}

function bigrams(text: string): Set<string> {
  const clean = normalize(text)
  const out = new Set<string>()
  for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2))
  /* 极短题干（少于 2 字）没有 bigram，退化为按字符集合比较，避免相似度恒为 0 */
  if (!out.size) clean.split('').forEach((char) => out.add(char))
  return out
}

/** 两段文本的相似度，0~1 */
export function textSimilarity(a: string, b: string): number {
  const setA = bigrams(a)
  const setB = bigrams(b)
  if (!setA.size || !setB.size) return 0
  let hit = 0
  for (const gram of setA) if (setB.has(gram)) hit += 1
  return hit / (setA.size + setB.size - hit)
}

/** 重复题判定阈值：0.82 以上基本是「同一道题换了个数字/标点」 */
export const DUPLICATE_THRESHOLD = 0.82

export interface SimilarHit {
  row: OrgQuestion
  /** 0~1，越大越像 */
  score: number
}

/**
 * 与目标题相似的题目。
 *
 * 题干相似度与知识点重合度加权（0.65 / 0.35）：只看题干会把「同一个知识点但完全不同的题」
 * 排在前面，只看知识点则会把整章的题都拉进来。同题型额外加权，因为换题时教师通常要同题型替换。
 */
export function similarQuestions(target: OrgQuestion, pool: OrgQuestion[], limit = 6): SimilarHit[] {
  const targetText = toPlainText(target.stem)
  const targetKp = new Set(target.knowledge)

  return pool
    .filter((row) => row.id !== target.id && row.subject === target.subject)
    .map((row) => {
      const overlap = row.knowledge.filter((tag) => targetKp.has(tag)).length
      const union = new Set([...targetKp, ...row.knowledge]).size || 1
      const sameType = row.type === target.type ? 0.08 : 0
      const score =
        textSimilarity(targetText, toPlainText(row.stem)) * 0.6 + (overlap / union) * 0.32 + sameType
      return { row, score }
    })
    .filter((hit) => hit.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export interface DuplicatePair {
  a: OrgQuestion
  b: OrgQuestion
  score: number
}

/**
 * 一组题里疑似重复的两两组合（每对只报一次）。
 *
 * 组卷车规模（几十题）下 O(n²) 完全可以接受；真要上千题再换倒排索引，
 * 现阶段引入反而更难维护。
 */
export function duplicatePairs(rows: OrgQuestion[], threshold = DUPLICATE_THRESHOLD): DuplicatePair[] {
  const texts = rows.map((row) => toPlainText(row.stem))
  const out: DuplicatePair[] = []
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const score = textSimilarity(texts[i], texts[j])
      if (score >= threshold) out.push({ a: rows[i], b: rows[j], score })
    }
  }
  return out.sort((x, y) => y.score - x.score)
}
