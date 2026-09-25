/**
 * 高考模拟卷种子：语文 / 数学 / 英语各一套完整卷（150 分），用于整卷预览与排版验收。
 *
 * 与其它种子题的区别在于「卷面完整」：大题带材料（现代文 / 文言文 / 古诗 / 英语短文），
 * 题型覆盖客观题、填空题、解答题与写作 —— 这样预览弹窗的自动分版、8K/A3 一面两版、
 * 答题卡（填涂区 / 作答横线 / 作答框）都能被真实数据撑满。
 *
 * 两类题的 stem 约定：
 * - 题干独立成题的（单选、多选、填空、解答、听力、阅读、写作）正常写 stem；
 * - 选项或答案依附于材料的（完形填空、语法填空、短文改错），材料里已用 (41) 标出空位，
 *   卷面只需印「题号 + 选项」，故 stem 留空 —— 与真实卷面上这些题型的排法一致。
 */
import type { OrgPaper, OrgQuestion, PaperSection } from '../api/models'

/** 种子时间固定写死：用相对时间会让每次刷新列表都在变 */
const UPDATED = '2026-09-20 16:40:00'

type Seed = {
  id: number
  stem: string
  /** 缺省为单选（听力、阅读、完形都是单选）；多选 / 填空 / 解答显式写出 */
  type?: string
  options?: string[]
  answer: string
  analysis: string
  difficulty?: string
  knowledge?: string[]
}

interface PaperBase {
  subject: string
  grade: string
  categoryId: number
  owner: string
  ownerId: number
}

function seedQuestion(base: PaperBase, row: Seed): OrgQuestion {
  return {
    subject: base.subject,
    grade: base.grade,
    type: '单选题',
    difficulty: '中等',
    source: '手动录入',
    status: 'approved',
    library: 'org',
    categoryId: base.categoryId,
    ownerId: base.ownerId,
    owner: base.owner,
    term: '上学期',
    examType: '模拟考试',
    useCount: row.id % 19,
    updatedAt: UPDATED,
    ...row,
    options: row.options ?? [],
    knowledge: row.knowledge ?? [],
  }
}

/* ==================================================================
   一、数学（新高考 I 卷结构）· 22 题 / 150 分
   单选 8×5 + 多选 4×5 + 填空 4×5 + 解答 10+12+12+12+12+12
   ================================================================== */

const MATH: PaperBase = { subject: '数学', grade: '高三', categoryId: 12, owner: '陈明远', ownerId: 101 }

const MATH_QUESTIONS: OrgQuestion[] = [
  seedQuestion(MATH, {
    id: 9201,
    stem: '已知集合 A = {x | x² − 3x − 4 ≤ 0}，B = {x | x > 1}，则 A ∩ B =（　　）',
    options: ['(1, 4]', '[1, 4]', '(1, 4)', '[−1, 4]'],
    answer: 'A',
    analysis: '由 x² − 3x − 4 ≤ 0 解得 −1 ≤ x ≤ 4，即 A = [−1, 4]；与 B = (1, +∞) 取交集得 A ∩ B = (1, 4]。',
    difficulty: '容易',
    knowledge: ['集合'],
  }),
  seedQuestion(MATH, {
    id: 9202,
    stem: '已知实数 a、b，则「a > b」是「a² > b²」的（　　）',
    options: ['充分不必要条件', '必要不充分条件', '充要条件', '既不充分也不必要条件'],
    answer: 'D',
    analysis:
      '取 a = 1、b = −2，有 a > b 但 a² = 1 < 4 = b²，故不充分；取 a = −2、b = 1，有 a² > b² 但 a < b，故不必要。因此是既不充分也不必要条件。',
    knowledge: ['常用逻辑用语'],
  }),
  seedQuestion(MATH, {
    id: 9203,
    stem: '已知 a = log₂3，b = log₃4，c = log₄5，则 a、b、c 的大小关系为（　　）',
    options: ['a > b > c', 'b > a > c', 'c > b > a', 'a > c > b'],
    answer: 'A',
    analysis:
      'log₂3 = 1 + log₂1.5 ≈ 1.585，log₃4 = 1 + log₃(4/3) ≈ 1.262，log₄5 = 1 + log₄(5/4) ≈ 1.161，故 a > b > c。也可用换底公式比较：a > b ⇔ lg3/lg2 > lg4/lg3 ⇔ (lg3)² > lg2·lg4。',
    difficulty: '较难',
    knowledge: ['对数函数'],
  }),
  seedQuestion(MATH, {
    id: 9204,
    stem: '函数 f(x) = 2sin(2x + π/6) 的图像（　　）',
    options: [
      '关于直线 x = π/6 对称',
      '关于直线 x = π/12 对称',
      '关于点 (π/6, 0) 对称',
      '最小正周期为 π/2',
    ],
    answer: 'A',
    analysis:
      '令 2x + π/6 = π/2 + kπ 得对称轴 x = π/6 + kπ/2，取 k = 0 得 x = π/6，故 A 正确、B 错误；令 2x + π/6 = kπ 得对称中心 (kπ/2 − π/12, 0)，x = π/6 不在其中，故 C 错误；最小正周期 T = 2π/2 = π，故 D 错误。',
    knowledge: ['三角函数'],
  }),
  seedQuestion(MATH, {
    id: 9205,
    stem: '双曲线 x²/4 − y²/12 = 1 的渐近线方程为（　　）',
    options: ['y = ±(1/2)x', 'y = ±2x', 'y = ±√3x', 'y = ±(√3/3)x'],
    answer: 'C',
    analysis: 'a² = 4，b² = 12，故 a = 2，b = 2√3，渐近线方程为 y = ±(b/a)x = ±√3x。',
    difficulty: '容易',
    knowledge: ['圆锥曲线'],
  }),
  seedQuestion(MATH, {
    id: 9206,
    stem: '已知圆锥的底面半径为 2，母线长为 4，则该圆锥的体积为（　　）',
    options: ['8√3π/3', '4√3π/3', '8π/3', '16√3π/3'],
    answer: 'A',
    analysis: '圆锥的高 h = √(4² − 2²) = 2√3，体积 V = (1/3)πr²h = (1/3)·π·4·2√3 = 8√3π/3。',
    difficulty: '容易',
    knowledge: ['立体几何'],
  }),
  seedQuestion(MATH, {
    id: 9207,
    stem: '已知等差数列 {aₙ} 中，a₁ = 1，a₃ + a₅ = 14，则 a₇ =（　　）',
    options: ['13', '15', '12', '11'],
    answer: 'A',
    analysis: '由 a₃ + a₅ = 2a₁ + 6d = 2 + 6d = 14 得公差 d = 2，故 a₇ = a₁ + 6d = 1 + 12 = 13。',
    difficulty: '容易',
    knowledge: ['数列'],
  }),
  seedQuestion(MATH, {
    id: 9208,
    stem: '已知 f(x) 是定义在 R 上的偶函数，且在区间 [0, +∞) 上单调递增，则满足 f(2x − 1) < f(1) 的 x 的取值范围是（　　）',
    options: ['(0, 1)', '(−∞, 0) ∪ (1, +∞)', '(0, 1/2)', '(1/2, 1)'],
    answer: 'A',
    analysis: '偶函数在 [0, +∞) 上单调递增，故 f(2x − 1) < f(1) 等价于 |2x − 1| < 1，即 −1 < 2x − 1 < 1，解得 0 < x < 1。',
    knowledge: ['函数单调性'],
  }),
  seedQuestion(MATH, {
    id: 9209,
    stem: '已知函数 f(x) = sin x + cos x，则下列结论正确的是（　　）',
    type: '多选题',
    options: [
      'f(x) 的最大值为 √2',
      'f(x) 的最小正周期为 2π',
      'f(x) 的图像关于直线 x = π/4 对称',
      'f(x) 在区间 (0, π/2) 上单调递增',
    ],
    answer: 'ABC',
    analysis:
      'f(x) = √2·sin(x + π/4)。A：最大值为 √2，正确。B：最小正周期 T = 2π，正确。C：令 x + π/4 = π/2 + kπ 得对称轴 x = π/4 + kπ，故 x = π/4 是对称轴，正确。D：当 x ∈ (0, π/2) 时 x + π/4 ∈ (π/4, 3π/4)，正弦函数在此区间上先增后减，故 D 错误。',
    knowledge: ['三角恒等变换'],
  }),
  seedQuestion(MATH, {
    id: 9210,
    stem: '已知等比数列 {aₙ} 的首项 a₁ = 1，公比 q = −2，前 n 项和为 Sₙ，则下列结论正确的是（　　）',
    type: '多选题',
    options: ['a₄ = −8', 'S₄ = −5', '数列 {aₙ} 是递减数列', 'a₁ + a₃ + a₅ = 21'],
    answer: 'ABD',
    analysis:
      'a₄ = 1 × (−2)³ = −8，A 正确；S₄ = 1 − 2 + 4 − 8 = −5，B 正确；数列各项正负交替，不是递减数列，C 错误；a₁ + a₃ + a₅ = 1 + 4 + 16 = 21，D 正确。',
    knowledge: ['数列'],
  }),
  seedQuestion(MATH, {
    id: 9211,
    stem: '已知直线 l: kx − y + 1 = 0 与圆 C: x² + y² = 4，则下列结论正确的是（　　）',
    type: '多选题',
    options: [
      '直线 l 恒过定点 (0, 1)',
      '当 k = 0 时，直线 l 与圆 C 相切',
      '直线 l 与圆 C 恒有两个公共点',
      '当直线 l 被圆 C 截得的弦最短时，k = 0',
    ],
    answer: 'ACD',
    analysis:
      '把 (0, 1) 代入得 0 − 1 + 1 = 0 恒成立，A 正确。圆心到直线的距离 d = 1/√(k² + 1) ≤ 1 < 2（半径），故直线与圆恒相交、有两个公共点，C 正确而 B 错误（k = 0 时是相交，不是相切）。弦长 = 2√(4 − d²)，d 最大时弦最短，且 d 在 k = 0 时取最大值 1，故 D 正确。',
    difficulty: '较难',
    knowledge: ['解析几何'],
  }),
  seedQuestion(MATH, {
    id: 9212,
    stem: '已知函数 f(x) = x³ − 3x + 1，则下列结论正确的是（　　）',
    type: '多选题',
    options: ['f(x) 在区间 (−1, 1) 上单调递减', 'f(x) 的极大值为 3', 'f(x) 有三个零点', 'f(x) 在 x = 1 处取得极大值'],
    answer: 'ABC',
    analysis:
      'f′(x) = 3x² − 3，在 (−1, 1) 上 f′(x) < 0，A 正确；f(x) 在 x = −1 处取极大值 f(−1) = 3，在 x = 1 处取极小值 f(1) = −1，故 B 正确、D 错误；由 f(−2) < 0、f(0) > 0、f(1) < 0、f(2) > 0 及其单调性知 f(x) 在 (−2, −1)、(0, 1)、(1, 2) 内各有一个零点，共三个，C 正确。',
    difficulty: '较难',
    knowledge: ['函数与导数'],
  }),
  seedQuestion(MATH, {
    id: 9213,
    stem: '已知等差数列 {aₙ} 中，a₁ = 2，a₄ = 11，则 S₁₀ = ______。',
    type: '填空题',
    answer: '155',
    analysis: '公差 d = (a₄ − a₁)/3 = 3，故 S₁₀ = 10a₁ + 45d = 20 + 135 = 155。',
    difficulty: '容易',
    knowledge: ['数列'],
  }),
  seedQuestion(MATH, {
    id: 9214,
    stem: '抛物线 y² = 8x 的焦点到准线的距离为 ______。',
    type: '填空题',
    answer: '4',
    analysis: '由 y² = 2px 得 2p = 8，即 p = 4；焦点为 (2, 0)，准线为 x = −2，两者距离为 p = 4。',
    difficulty: '容易',
    knowledge: ['抛物线'],
  }),
  seedQuestion(MATH, {
    id: 9215,
    stem: '已知正方体 ABCD-A₁B₁C₁D₁ 的棱长为 2，则其外接球的表面积为 ______。',
    type: '填空题',
    answer: '12π',
    analysis: '正方体的体对角线长等于其外接球的直径，即 2R = √(2² + 2² + 2²) = 2√3，故 R = √3，表面积 S = 4πR² = 12π。',
    knowledge: ['立体几何'],
  }),
  seedQuestion(MATH, {
    id: 9216,
    stem: '若函数 f(x) = x³ − 3ax 在区间 (1, +∞) 上单调递增，则实数 a 的取值范围是 ______。',
    type: '填空题',
    answer: 'a ≤ 1',
    analysis: 'f′(x) = 3x² − 3a，在 (1, +∞) 上单调递增需 f′(x) ≥ 0 恒成立，即 a ≤ x² 对任意 x > 1 恒成立；x² > 1，故 a ≤ 1。',
    knowledge: ['导数概念'],
  }),
  seedQuestion(MATH, {
    id: 9217,
    stem: `在 △ABC 中，内角 A、B、C 的对边分别为 a、b、c，已知 b = 2，c = 3，cos A = 1/3。
（1）求 a 的值；
（2）求 △ABC 的面积。`,
    type: '解答题',
    answer: '（1）a = 3；（2）△ABC 的面积为 2√2',
    analysis: `（1）由余弦定理得 a² = b² + c² − 2bc·cos A = 4 + 9 − 2 × 2 × 3 × (1/3) = 9，故 a = 3。
（2）由 cos A = 1/3 得 sin A = √(1 − 1/9) = 2√2/3，故 S = (1/2)bc·sin A = (1/2) × 2 × 3 × (2√2/3) = 2√2。`,
    knowledge: ['三角函数'],
  }),
  seedQuestion(MATH, {
    id: 9218,
    stem: `已知数列 {aₙ} 的前 n 项和为 Sₙ，且 Sₙ = 2aₙ − 2（n ∈ N*）。
（1）求数列 {aₙ} 的通项公式；
（2）设 bₙ = n·aₙ，求数列 {bₙ} 的前 n 项和 Tₙ。`,
    type: '解答题',
    answer: '（1）aₙ = 2ⁿ；（2）Tₙ = (n − 1)·2ⁿ⁺¹ + 2',
    analysis: `（1）当 n = 1 时 a₁ = S₁ = 2a₁ − 2，得 a₁ = 2；当 n ≥ 2 时 aₙ = Sₙ − Sₙ₋₁ = 2aₙ − 2aₙ₋₁，即 aₙ = 2aₙ₋₁，故 {aₙ} 是首项为 2、公比为 2 的等比数列，aₙ = 2ⁿ。
（2）用错位相减法：Tₙ = 1·2 + 2·2² + … + n·2ⁿ，两边乘 2 得 2Tₙ = 1·2² + … + (n − 1)·2ⁿ + n·2ⁿ⁺¹，相减得 −Tₙ = 2 + 2² + … + 2ⁿ − n·2ⁿ⁺¹ = 2ⁿ⁺¹ − 2 − n·2ⁿ⁺¹，故 Tₙ = (n − 1)·2ⁿ⁺¹ + 2。`,
    knowledge: ['数列'],
  }),
  seedQuestion(MATH, {
    id: 9219,
    stem: `在四棱锥 P-ABCD 中，底面 ABCD 是边长为 2 的正方形，PA ⊥ 平面 ABCD，PA = 2，E 为 PB 的中点。
（1）证明：AD ∥ 平面 PBC；
（2）求二面角 E-AD-B 的余弦值。`,
    type: '解答题',
    answer: '（1）证明见解析；（2）二面角 E-AD-B 的余弦值为 √2/2',
    analysis: `（1）因为 ABCD 是正方形，所以 AD ∥ BC；又 BC ⊂ 平面 PBC，AD ⊄ 平面 PBC，由线面平行的判定定理得 AD ∥ 平面 PBC。
（2）以 A 为原点，AB、AD、AP 所在直线分别为 x、y、z 轴建立空间直角坐标系，则 A(0,0,0)、B(2,0,0)、D(0,2,0)、P(0,0,2)、E(1,0,1)。平面 ABD（即底面）的一个法向量 n₁ = (0,0,1)；设平面 EAD 的法向量 n₂ = (x,y,z)，由 AE = (1,0,1)、AD = (0,2,0) 得 x + z = 0 且 y = 0，取 n₂ = (1,0,−1)。于是 cos⟨n₁,n₂⟩ = −1/√2 = −√2/2，故二面角 E-AD-B 的余弦值为 √2/2。`,
    difficulty: '较难',
    knowledge: ['空间向量'],
  }),
  seedQuestion(MATH, {
    id: 9220,
    stem: `已知椭圆 C: x²/a² + y²/b² = 1（a > b > 0）的离心率为 √2/2，且经过点 (2, 1)。
（1）求椭圆 C 的方程；
（2）设直线 l: y = x + m 与椭圆 C 交于 A、B 两点，O 为坐标原点。若 OA ⊥ OB，求 m 的值。`,
    type: '解答题',
    answer: '（1）x²/6 + y²/3 = 1；（2）m = ±2',
    analysis: `（1）由 e = c/a = √2/2 得 c² = a²/2，故 b² = a² − c² = a²/2。把点 (2, 1) 代入得 4/a² + 1/b² = 1，即 4/a² + 2/a² = 1，解得 a² = 6，b² = 3，椭圆 C 的方程为 x²/6 + y²/3 = 1。
（2）由 x²/6 + (x + m)²/3 = 1 整理得 3x² + 4mx + 2m² − 6 = 0，设 A(x₁,y₁)、B(x₂,y₂)，则 x₁ + x₂ = −4m/3，x₁x₂ = (2m² − 6)/3。由 OA ⊥ OB 得 x₁x₂ + y₁y₂ = 0，而 y₁y₂ = (x₁ + m)(x₂ + m) = x₁x₂ + m(x₁ + x₂) + m²，代入得 2x₁x₂ + m(x₁ + x₂) + m² = 0，即 (4m² − 12)/3 − 4m²/3 + m² = 0，解得 m² = 4，故 m = ±2（此时判别式 Δ = 72 − 8m² > 0，满足题意）。`,
    difficulty: '困难',
    knowledge: ['圆锥曲线'],
  }),
  seedQuestion(MATH, {
    id: 9221,
    stem: `已知函数 f(x) = ln x − ax（a ∈ R）。
（1）讨论 f(x) 的单调性；
（2）若 f(x) ≤ 0 对任意 x > 0 恒成立，求 a 的取值范围。`,
    type: '解答题',
    answer: '（1）a ≤ 0 时在 (0, +∞) 上单调递增；a > 0 时在 (0, 1/a) 上单调递增，在 (1/a, +∞) 上单调递减。（2）a ≥ 1/e',
    analysis: `（1）f′(x) = 1/x − a = (1 − ax)/x（x > 0）。当 a ≤ 0 时 f′(x) > 0 恒成立，f(x) 在 (0, +∞) 上单调递增；当 a > 0 时，x ∈ (0, 1/a) 时 f′(x) > 0，x ∈ (1/a, +∞) 时 f′(x) < 0，故 f(x) 在 (0, 1/a) 上单调递增，在 (1/a, +∞) 上单调递减。
（2）若 a ≤ 0，当 x → +∞ 时 f(x) = ln x − ax → +∞，不满足题意。若 a > 0，f(x) 的最大值为 f(1/a) = ln(1/a) − 1 = −ln a − 1，令 −ln a − 1 ≤ 0 得 ln a ≥ −1，即 a ≥ 1/e。综上，a 的取值范围是 [1/e, +∞)。`,
    difficulty: '较难',
    knowledge: ['函数与导数'],
  }),
  seedQuestion(MATH, {
    id: 9222,
    stem: `已知数列 {aₙ} 满足 a₁ = 1，aₙ₊₁ = 2aₙ + 1（n ∈ N*）。
（1）证明：数列 {aₙ + 1} 是等比数列；
（2）求数列 {aₙ} 的前 n 项和 Sₙ。`,
    type: '解答题',
    answer: '（1）证明见解析；（2）Sₙ = 2ⁿ⁺¹ − n − 2',
    analysis: `（1）由 aₙ₊₁ = 2aₙ + 1 得 aₙ₊₁ + 1 = 2aₙ + 2 = 2(aₙ + 1)；又 a₁ + 1 = 2 ≠ 0，故数列 {aₙ + 1} 是首项为 2、公比为 2 的等比数列。
（2）由（1）得 aₙ + 1 = 2ⁿ，即 aₙ = 2ⁿ − 1，故 Sₙ = (2 + 2² + … + 2ⁿ) − n = (2ⁿ⁺¹ − 2) − n = 2ⁿ⁺¹ − n − 2。`,
    knowledge: ['数列'],
  }),
]

/* ==================================================================
   二、语文（新课标 I 卷结构）· 23 题 / 150 分
   现代文阅读 19 + 16、古诗文阅读 20 + 9 + 6、语言文字运用 20、写作 60
   ================================================================== */

const CHINESE: PaperBase = { subject: '语文', grade: '高三', categoryId: 13, owner: '吴刚', ownerId: 102 }

const CHINESE_QUESTIONS: OrgQuestion[] = [
  /* ---- 现代文阅读（一）信息类文本 ---- */
  seedQuestion(CHINESE, {
    id: 9223,
    stem: '下列关于原文内容的理解和分析，正确的一项是（　　）',
    options: [
      '非遗以「人」为载体，因此其保护只能依靠传承人的口传心授',
      '把非遗改造成舞台上的展演节目，必然会使其丧失内在的创造力',
      '昆曲、京剧的演变说明非遗可以在场景转换中完成自我更新',
      '只要把一种技艺完整地记录、拍摄并入库，它就不会成为死去的遗产',
    ],
    answer: 'C',
    analysis:
      'A 项把原文「不能仅靠博物馆式的静态收藏」绝对化为「只能依靠口传心授」；B 项原文说的是「可能」而非「必然」；D 项与原文「即便被完整地记录、拍摄、入库，也仍然是死去的遗产」相反。C 项与原文第二段举昆曲、徽班进京之例所得的结论一致。',
    knowledge: ['论述类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9224,
    stem: '下列对原文论证的相关分析，不正确的一项是（　　）',
    options: [
      '文章以「青铜器」与「山歌」作对比，说明非遗的存在方式区别于物质文化遗产',
      '文章先引述学者的观点，再指出其疏漏，体现了辩证分析的态度',
      '文章第三段从「传承链条的中断」切入，论证活态传承的核心所在',
      '文章认为创新与变异之间没有边界，凡属新形式都应予以肯定',
    ],
    answer: 'D',
    analysis:
      'D 项曲解文意。原文说的是「创新与变异之间有边界」，并以「是否仍然承续着这一文化遗产特有的精神内核与技艺逻辑」作为判断标准，并非对一切新形式都予以肯定。',
    knowledge: ['论述类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9225,
    stem: '根据原文内容，下列说法不正确的一项是（　　）',
    options: [
      '所谓「原汁原味」，在一定程度上是一种后设的想象',
      '判断非遗创新是否越界，关键在于是否承续其精神内核与技艺逻辑',
      '让民间音乐走进当代创作的语汇，是为非遗寻找当代意义支点的一种做法',
      '非遗从生活方式退化为文化符号，是其发展过程中的必然结果',
    ],
    answer: 'D',
    analysis:
      'D 项把原文「一旦……便可能」的可能性判断偷换为「必然结果」，且作者对舞台化展演持辩证态度，并未认定其为必然归宿。',
    knowledge: ['论述类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9226,
    stem: '请简要分析文章第二段的论证思路。（4 分）',
    type: '解答题',
    answer:
      '第二段先指出「非遗进校园」「非遗入景区」等实践在收效之外引发了争论；接着摆出有学者的观点——非遗一旦被抽离原有的生活场景，就可能从「生活方式」退化为「文化符号」，其内在的创造力反而被固化；随后指出这一说法忽略了「非遗从来不是一成不变的」这一基本事实，并以昆曲从草台走向剧场、徽班进京演化为京剧为例加以论证；最后得出「所谓『原汁原味』更多是一种后设的想象」的结论。全段采用「提出争论—引述观点—反驳举例—得出结论」的层进式思路。',
    analysis:
      '4 分题。能依次答出「提出争论」「引述学者观点」「指出疏漏并以昆曲、京剧为例反驳」「得出结论」四个层次，层次清楚、表述完整即可得满分。',
    knowledge: ['论述类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9227,
    stem: '结合文章内容，谈谈你对「活态传承的核心在于为非遗寻找当代的生活场景与意义支点」这句话的理解。（6 分）',
    type: '解答题',
    answer:
      '①非遗的存在方式是「人」而不是「物」，它的生命力在于被使用、被需要；一旦脱离生活场景，即使被完整记录入库也仍是死去的遗产，因此保护的关键不是静态留存，而是让它在当代继续「活」着。②所谓「寻找当代的生活场景与意义支点」，就是让传统技艺进入现代设计、让民间音乐融入当代创作语汇，为传承提供现实的场合与真实的需求，使传承人有意愿、有场合继续传下去。③这种进入不是削足适履的迎合，而是以传统为资源去回应今天的审美与需求；同时必须以是否承续遗产特有的精神内核与技艺逻辑为边界，否则不过是借非遗之名的文化消费品。',
    analysis: '6 分题，三个要点各 2 分：对「活态」的理解、对「当代场景与意义支点」的具体阐释、对「创新与守界」的把握。意思对即可。',
    difficulty: '较难',
    knowledge: ['论述类文本'],
  }),

  /* ---- 现代文阅读（二）文学类文本 ---- */
  seedQuestion(CHINESE, {
    id: 9228,
    stem: '下列对小说相关内容的理解，不正确的一项是（　　）',
    options: [
      '孩子们趴在桥栏杆上朝下吐唾沫，写出了新桥给乡村生活带来的变化与孩子们的闲散',
      '渡口从「挤满挑担的、赶集的、上学的」到「一天也未必有一个人上船」，反映了交通方式的改变',
      '祖父在桥修通后仍旧每天擦拭船板、静坐看水，说明他不愿承认时代已经变化，对现实心存怨恨',
      '祖父说「船在，渡口就在」，表现了他对渡口所承载的那种生活方式的珍视',
    ],
    answer: 'C',
    analysis:
      'C 项「对现实心存怨恨」于文无据，属于过度解读。祖父的守望是珍视而非怨怼，结尾「总要有人记得，这河从前是怎么过来的」更见其通达与深情。',
    knowledge: ['文学类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9229,
    stem: '小说第二段为什么要写「桥」？请简要分析。（4 分）',
    type: '解答题',
    answer:
      '①从情节看，桥的修通是渡口冷清的直接原因，交代了故事发生的背景与祖父处境变化的外部条件。②从意象看，桥与渡口构成今昔对照：水泥的桥面、咚咚作响的脚步声与铁栏杆，同木船、均匀的桨声形成冷暖分明的对照，形象地写出了传统生活方式被现代交通方式取代的现实。③从人物看，桥衬托了祖父守候的姿态——在桥上人来人往的热闹里，只有他还守着一条空船，为下文雾中远望、「船在，渡口就在」的描写作了铺垫。',
    analysis: '4 分题。答出「交代原因与背景」「与渡口形成今昔对照」「衬托祖父形象并作铺垫」三点，每点 1～2 分，意思对即可。',
    knowledge: ['文学类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9230,
    stem: '文中祖父说「你听」之后，「我」听不见任何声音，祖父却说自己听见了桨声。你如何理解这一处描写？（4 分）',
    type: '解答题',
    answer:
      '①从实写看，河面空无一人，桨声并不存在，祖父听见的是记忆中的声音，甚至是一种错觉。②从虚写看，桨声是祖父一生劳作的印记，已经化为他身体里的节律，「我划了一辈子桨，一听就知道」写出了技艺与生命融为一体的境界。③这一处描写把祖父对渡口岁月的守护由外在行为升华为内在精神，也暗示这样的声音只有老一辈才听得见，寄托了作者对正在消逝的生活方式的惋惜与敬意。',
    analysis: '4 分题。能从「记忆与错觉（实）」「技艺已内化为生命节律（虚）」「主题上的惋惜与敬意」三个层次作答即可。',
    difficulty: '较难',
    knowledge: ['文学类文本'],
  }),
  seedQuestion(CHINESE, {
    id: 9231,
    stem: '小说以祖父的话「总要有人记得，这河从前是怎么过来的」作结，请探究这句话的丰富意蕴。（5 分）',
    type: '解答题',
    answer:
      '①表层意蕴：对村里人而言，记住渡口与木船，就是记住一段真实存在过的生活史，记住这河两岸的人曾经怎样往来、怎样生活。②深层意蕴：变化不可阻挡，但被变化取代的东西不应被彻底抹去，「记得」是对过往生活方式的尊重，也是人在时代更替中保持自持的方式。③人物意蕴：这句话虽出自祖父一人之口，却把个人的守望提升为对后辈的嘱托——所谓传承，首先在于记忆的延续。④表达意蕴：以人物语言收束全篇，言近旨远、余味悠长，使小说的悲剧感与温情并存，深化了主题。',
    analysis: '5 分题，答出「记住生活史」「对旧事物的尊重与人的自持」「一代人的嘱托」「以人物语言作结的表达效果」四个层面得满分，意思对即可。',
    difficulty: '困难',
    knowledge: ['文学类文本'],
  }),

  /* ---- 文言文阅读 ---- */
  seedQuestion(CHINESE, {
    id: 9232,
    stem: '下列对文中相关词语的解说，不正确的一项是（　　）',
    options: [
      '「孤」指幼年丧父，「少孤」即范仲淹幼年失去父亲',
      '「进士第」指科举时代考中进士，「举进士第」即考中进士',
      '「谥」是古代帝王或高官死后依其生前行迹给予的称号，「文正」即范仲淹的谥号',
      '「赠」指把官职赏赐给在世的功臣以示褒奖，「赠兵部尚书」意为范仲淹生前获授兵部尚书',
    ],
    answer: 'D',
    analysis: 'D 项错误。「赠」是古代朝廷对已死者的追封（赠官），「赠兵部尚书」是在范仲淹去世后追赠的官衔，而非生前授予。',
    knowledge: ['实词虚词'],
  }),
  seedQuestion(CHINESE, {
    id: 9233,
    stem: '下列对原文有关内容的概括和分析，不正确的一项是（　　）',
    options: [
      '范仲淹幼年丧父，母亲改嫁，他长大以后得知自己的身世，便辞别母亲前往应天府求学',
      '范仲淹求学时刻苦自励，冬日疲惫时用冷水洗脸，粮食不够就以稀粥充饥，并不以此为苦',
      '范仲淹考中进士后恢复本姓并改名，此后虽地位显贵，生活依然俭朴，只有待客时才上两种以上的肉食',
      '范仲淹生性孝顺，但为人刚愎自用，与同族相处时严苛少恩，因此并不为乡人所称道',
    ],
    answer: 'D',
    analysis:
      'D 项与原文相悖。原文说的是「内刚外和」「好施予，泛爱乡族，以俸禄赡之」，可见他待乡族宽厚有恩，并无刚愎自用、严苛少恩之实。',
    knowledge: ['古代文化常识'],
  }),
  seedQuestion(CHINESE, {
    id: 9234,
    stem: '下列对文中「昼夜不息，冬月惫甚，以水沃面；食不给，至以糜粥继之，人不能堪，仲淹不苦也」一句的翻译，最准确的一项是（　　）',
    options: [
      '白天黑夜都不停息，冬天十分疲惫，用水洗脸；食物供应不上，就用稀粥接续，别人不能忍受，范仲淹也不觉得苦',
      '昼夜不停地读书，冬夜疲惫得厉害，就用冷水洗脸；粮食不够，以至于用稀粥充饥，别人受不了，范仲淹却并不以此为苦',
      '昼夜不停地读书，冬天疲倦时用水擦拭面容；食物不够，就到外面买粥喝，一般人无法忍受，范仲淹也不觉得苦',
      '昼夜不休息，冬日疲惫时用冷水浇头；食物断绝，只好用稀粥度日，人们不能忍受，范仲淹却不以为苦',
    ],
    answer: 'B',
    analysis:
      'A 项「冬月」译作「冬天」不确，且「不能忍受……也不觉得苦」前后失照；C 项「沃面」是洗脸而非「擦拭面容」，「至以糜粥继之」是「用稀粥充饥」而非「到外面买粥」；D 项「以水沃面」不是「用冷水浇头」，「食不给」是粮食不够而非「食物断绝」。B 项对「冬月」「沃面」「食不给」「至以糜粥继之」的处理最为准确。',
    difficulty: '较难',
    knowledge: ['断句与翻译'],
  }),
  seedQuestion(CHINESE, {
    id: 9235,
    stem: `把文中画线的句子翻译成现代汉语。（8 分）
（1）既长，知其世家，乃感泣辞母，去之应天府。（4 分）
（2）其后虽贵，非宾客不重肉，妻子衣食仅能自充。（4 分）`,
    type: '解答题',
    answer:
      '（1）长大后，他知道了自己的家世，于是感慨流泪，辞别母亲，前往应天府。\n（2）他后来虽然地位显贵，但如果不是招待宾客，吃饭就不上两种以上的肉食，妻子儿女的衣食也仅仅能够自给。',
    analysis:
      '（1）得分点：「既长」（已经长大）、「知其世家」、「感泣」、「去之」（前往）各 1 分。（2）得分点：「虽贵」、「非宾客」、「重肉」（两种以上的肉食）、「妻子」（妻子儿女）各 1 分。两小题句子通顺各计 1 分，共 8 分。',
    knowledge: ['断句与翻译'],
  }),
  seedQuestion(CHINESE, {
    id: 9236,
    stem: '文中说范仲淹「内刚外和」，请结合文章简要概括这一品质体现在哪些地方。（3 分）',
    type: '解答题',
    answer:
      '①求学时刻苦自励，昼夜不息，冬夜疲惫以水沃面、粮食不足以糜粥继之而不以为苦，可见其「刚」；②显贵之后生活俭朴，非宾客不重肉，妻子衣食仅能自充，可见其持身之严；③「好施予，泛爱乡族」，以俸禄赡养同族，可见其「和」。',
    analysis: '3 分题，每点 1 分（求学之刚、持身之俭、待族之和），意思对即可。',
    knowledge: ['实词虚词'],
  }),

  /* ---- 古代诗歌阅读 ---- */
  seedQuestion(CHINESE, {
    id: 9237,
    stem: '下列对这首诗的理解和赏析，不正确的一项是（　　）',
    options: [
      '首联点明时间、地点与季节，「空山」「新雨」营造出清幽明净的氛围',
      '颔联写月色与泉声，「照」与「流」动静相衬，写出山间夜色的清朗与生机',
      '颈联通过「竹喧」「莲动」写浣女与渔舟的归来，以动衬静，反衬山居的幽静',
      '尾联化用典故，表达诗人对山中春色的留恋，感叹春光易逝、美景难留',
    ],
    answer: 'D',
    analysis:
      'D 项理解有误。尾联「随意春芳歇，王孙自可留」意为任凭春天的芳菲凋谢，（山中秋景如此美好）我自可以留在山中；诗人化用《楚辞·招隐士》「王孙兮归来，山中兮不可久留」而反用其意，表达的恰是不恋春芳、愿归隐山中的情怀，而非感叹春光易逝。',
    knowledge: ['诗歌鉴赏'],
  }),
  seedQuestion(CHINESE, {
    id: 9238,
    stem: '「竹喧归浣女，莲动下渔舟」两句历来为人称道，请简要赏析。（6 分）',
    type: '解答题',
    answer:
      '①语序上，诗人把「竹喧」放在「归浣女」之前、把「莲动」放在「下渔舟」之前，按感知的先后顺序来写：先听到竹林里的喧笑，才想到是浣女归来；先看到莲叶摇动，才知有渔舟下行。因果倒装而更觉真切，画面也有了「先闻其声、后见其人」的层次。②写法上，以「竹喧」「莲动」的动态写人的活动，动静相衬，幽静的山居因此透出生活的热闹与生机，静而不冷。③内容上，浣女、渔舟的暮归与明月、清泉共同构成一幅和谐恬淡的山居晚景图，寄托了诗人对纯朴宁静生活的喜爱与归隐之志。④语言上，两句对仗工整，「喧」「动」以声、以形写人，不着一「人」字而人物自现，含蓄而富有余味。',
    analysis: '6 分题。答出「语序与感官的先后」「以动衬静、动静相生」「人情美与归隐之志」「对仗与含蓄的表达效果」四点中的三点即可得满分，意思对即可。',
    difficulty: '较难',
    knowledge: ['诗歌鉴赏'],
  }),

  /* ---- 名篇名句默写 ---- */
  seedQuestion(CHINESE, {
    id: 9239,
    stem: `补写出下列句子中的空缺部分。（6 分）
（1）苏轼《赤壁赋》中，「______，______」两句以蜉蝣与沧海为喻，抒发人生短暂的感慨。
（2）李白《蜀道难》中，以「______，______」极言蜀道之高险，并接以「使人听此凋朱颜」写其威慑之力。
（3）杜甫《登高》中，「______，______」两句以落叶与江水写秋景之壮阔，成为千古名句。`,
    type: '填空题',
    answer: '（1）寄蜉蝣于天地　渺沧海之一粟　（2）蜀道之难　难于上青天　（3）无边落木萧萧下　不尽长江滚滚来',
    analysis: '本题共 3 小题、6 空，每答对一空得 1 分，错字、漏字、多字均不得分。注意「蜉蝣」「渺」「沧」「粟」「萧萧」的写法。',
    difficulty: '容易',
    knowledge: ['古代文化常识'],
  }),

  /* ---- 语言文字运用 ---- */
  seedQuestion(CHINESE, {
    id: 9240,
    stem: '请在文中横线处填入恰当的成语。（4 分）',
    type: '填空题',
    answer: '①截然不同　②错落有致　③一去不返　④无所适从',
    analysis:
      '①处写两岸风物的变化，宜用「截然不同」；②处写老屋高低不齐而自有格局，宜用「错落有致」；③处指旧日光景不再，宜用「一去不返」；④处写初来者面对慢节奏的手足无措，宜用「无所适从」。答案不唯一，符合语境、合乎成语用法即可。',
    knowledge: ['语言文字运用'],
  }),
  seedQuestion(CHINESE, {
    id: 9241,
    stem: '文中画线的句子在表述上存在两处问题，请找出并加以修改。（4 分）',
    type: '解答题',
    answer:
      '①缺主语：「通过……使……」使句子没有主语，应删去「通过」或删去「使」，如改为「这次调研使我们认识到保护运河老街的紧迫性」。②两面对一面：「能否留住这些老屋」包含「能」与「不能」两面，而「关键在于资金投入的持续性」只说了一面，应改为「关键在于资金投入是否具有持续性」，或把前一分句改为「要留住这些老屋」。',
    analysis: '4 分题，每找出一处并改对得 2 分。第一处考查「通过……使……」淹没主语，第二处考查一面对两面。',
    knowledge: ['语言文字运用'],
  }),
  seedQuestion(CHINESE, {
    id: 9242,
    stem: '请在文中横线处补写恰当的语句，使整段文字语意完整连贯，内容贴切，逻辑严密，每处不超过 15 个字。（4 分）',
    type: '填空题',
    answer: '①再漫上斑驳的门楣　②四乡的船都要在这里过夜',
    analysis:
      '①处承上文「灯光先染黄了木格窗子」，应写灯光继续照亮门、墙一类的句子，并与下句「也照亮了檐下的青石台阶」构成由高到低的层次；②处要交代夜里卸货后船工需要落脚，才能与下文「谁家的灯亮着，船工就往谁家去」自然衔接。每处 2 分，意思对、字数合乎要求即可。',
    difficulty: '较难',
    knowledge: ['语言文字运用'],
  }),
  seedQuestion(CHINESE, {
    id: 9243,
    stem: '请赏析文末「那些灯连成一路，像给老街系上了一串不灭的铃」一句的表达效果。（5 分）',
    type: '解答题',
    answer:
      '①比喻新奇：把沿街连缀的灯火比作「系在老街上的一串铃」，抓住灯「成串、相连」与铃「成串、有声」的相似点，把视觉上的光转为可以想见的声响，使静态的夜景有了动态与声音。②「不灭」一语双关：既写灯每夜照旧亮起，也暗指老街人的守望与记忆不曾断绝，赋予灯火以象征意味。③与上文「码头早已不用」形成对照，在同一条老街上把冷清的现状与温暖的坚守并置，含蓄地表达了作者对老街与守灯人的敬意，收束全文而余味悠长。',
    analysis: '5 分题，答出「比喻的相似点与表达效果」「『不灭』的双关与象征」「与全文情感的呼应」三点得满分，意思对即可。',
    difficulty: '较难',
    knowledge: ['语言文字运用'],
  }),
  seedQuestion(CHINESE, {
    id: 9244,
    stem: '文中「老人却仍旧每晚把灯点上」一句，若改为「老人却仍旧每晚点灯」，表达效果有何不同？下列分析最恰当的一项是（　　）',
    options: [
      '改句更简洁，原句因使用「把」字句而显得啰嗦，不如改句',
      '原句用「把」字句，突出对「灯」的处理过程，动作显得郑重而有仪式感；改句为一般叙述，语气平缓，郑重之意减弱',
      '两句表达效果完全相同，只是句式不同',
      '原句是口语，改句是书面语，改后更符合全文的书面语风格',
    ],
    answer: 'B',
    analysis:
      '原句「把灯点上」是「把」字句，宾语「灯」被提前并突出对其的处理，动作因此显得郑重、有仪式感，更能表现老人守灯的执着；改句是一般主谓句，语意基本不变而语气趋于平缓，郑重意味减弱。A 项误解了「把」字句的作用，C 项否认句式差异带来的效果差别，D 项对两种句式的语体判断有误。',
    knowledge: ['语言文字运用'],
  }),

  /* ---- 写作 ---- */
  seedQuestion(CHINESE, {
    id: 9245,
    stem: '阅读下面的材料，根据要求写作。（60 分）',
    type: '解答题',
    answer: '（略）符合题意、中心明确、内容充实、结构完整、语言通顺，不少于 800 字。',
    analysis:
      '本题为材料作文。材料给出两种看似对立的看法：一是有些价值只能由「慢」来成全；二是快慢本无优劣，关键在取舍。可切入的角度有：①在效率至上的时代为「慢」辩护，论述耐心、积淀与深耕的意义；②辩证看待快慢，论述「知所先后」的判断力与分寸感；③把快与慢看作相互成就的关系，快是为慢留出空间。评分参照高考作文评分标准：一类卷 54～60 分，二类卷 42～53 分，三类卷 30～41 分，四类卷 29 分以下。',
    knowledge: ['议论文写作'],
  }),
]

/** 语文各大题的材料（现代文 / 文言文 / 古诗 / 语段 / 作文题）：预览时印在大题标题之下 */
const CHINESE_MATERIALS: Record<number, { hint?: string; material?: string }> = {
  401: {
    hint: '阅读下面的文字，完成 1～5 题。',
    material: `非物质文化遗产（以下简称「非遗」）是民族文化的活态记忆。与物质文化遗产不同，非遗的存在方式不是「物」，而是「人」——它附着在传承人的技艺、口传与身体记忆之中。这决定了非遗保护不能只靠博物馆式的静态收藏：一件青铜器可以离开人而存在，一段山歌却只能活在传唱之中。

近年来，「非遗进校园」「非遗入景区」等实践广泛展开，收效之外也引发争论。有学者指出，一旦把非遗从原有的生活场景中抽离，改造成舞台上的展演节目，它便可能从「生活方式」退化为「文化符号」，其内在的创造力反而被固化。此说不无道理，却忽略了一个基本事实：非遗从来不是一成不变的。昆曲从明清的草台走向今天的剧场，徽班进京演化为京剧，都是在场景转换中完成的自我更新。所谓「原汁原味」，更多是一种后设的想象。

真正值得警惕的不是场景的变化，而是传承链条的中断。一种技艺若不再有人愿意学、不再有场合需要它，即便被完整地记录、拍摄、入库，也仍然是死去的遗产。因此，活态传承的核心在于为非遗寻找当代的生活场景与意义支点：让传统技艺进入现代设计，让民间音乐走进当代创作的语汇。这种进入不是削足适履的迎合，而是以传统为资源，回应今天的审美与需求。

当然，创新与变异之间有边界。判断的标准并不在形式的新旧，而在是否仍然承续着这一文化遗产特有的精神内核与技艺逻辑。失去内核的「创新」，只是借了非遗之名的文化消费品。`,
  },
  402: {
    hint: '阅读下面的文字，完成 6～9 题。',
    material: `《渡口》节选

祖父的船是这片水面上最后的木船。

我懂事的时候，河上已经通了桥。桥是新修的，水泥的，走上去咚咚作响，两边有铁栏杆，孩子们趴在栏杆上朝下吐唾沫，看它们落进水里砸出一圈一圈的印子。桥通了以后，渡口就冷清下来。从前每天早上，渡口挤满挑担的、赶集的、上学的，祖父的木船在水面上来来回回，桨声均匀得像一种心跳。如今一天也未必有一个人上船，祖父却照旧天不亮就起来，把船板擦净，把缆绳解开又系上，然后坐在船头，看水。

母亲劝他上岸住。他说：「船在，渡口就在。」

那年冬天我回乡，祖父已经病了一场。他让我扶他到河边。水面上起了雾，桥的影子在雾里若隐若现，祖父眯着眼睛看了很久，忽然说：「你听。」我听不见什么。他说：「桨声。我划了一辈子桨，一听就知道。」可水面上什么也没有，安静得连风都没有。

「爷爷，没人过河了。」
「有人。」他说，「总要有人记得，这河从前是怎么过来的。」`,
  },
  403: {
    hint: '阅读下面的文言文，完成 10～14 题。',
    material: `范仲淹，字希文，苏州吴县人。少孤，母更适长山朱氏，从其姓，名说。既长，知其世家，乃感泣辞母，去之应天府，依戚同文学。昼夜不息，冬月惫甚，以水沃面；食不给，至以糜粥继之，人不能堪，仲淹不苦也。举进士第，为广德军司理参军，始还姓，更其名。仲淹内刚外和，性至孝。其后虽贵，非宾客不重肉，妻子衣食仅能自充。而好施予，泛爱乡族，以俸禄赡之。卒，赠兵部尚书，谥文正。`,
  },
  404: {
    hint: '阅读下面这首唐诗，完成 15～16 题。',
    material: `山居秋暝
　　　　　王维

空山新雨后，天气晚来秋。
明月松间照，清泉石上流。
竹喧归浣女，莲动下渔舟。
随意春芳歇，王孙自可留。`,
  },
  406: {
    hint: '阅读下面的文字，完成 18～19 题。',
    material: `沿着运河一路向南，两岸的风物渐渐变得①________。岸边的老屋②________，青砖墙上爬满了藤蔓，偶尔有一扇木门半开着，露出里面的竹椅与茶壶。码头上人声鼎沸的旧日光景早已③________，如今只剩下三两户人家，守着这条安静下来的老街。老街的日子很慢，慢得让初来的人一时④________，连走路都不知该快还是该慢，住久了却觉出一种安稳的力量。

通过这次调研，使我们认识到保护运河老街的紧迫性，也让我们体会到，能否留住这些老屋，关键在于资金投入的持续性。`,
  },
  407: {
    hint: '阅读下面的文字，完成 20～22 题。',
    material: `老街上的灯，是从黄昏开始一盏一盏亮起来的。灯光先染黄了木格窗子，①________，也照亮了檐下的青石台阶。守灯的老人说，从前码头上夜里卸货，②________，谁家的灯亮着，船工就往谁家去。如今码头早已不用，老人却仍旧每晚把灯点上。那些灯连成一路，像给老街系上了一串不灭的铃。`,
  },
  408: {
    material: `有人在快与慢之间反复权衡：技术把一切变快了，可有些东西只能用慢来成全——一棵树的长成、一门手艺的纯熟、一个人与一座城彼此熟悉，都急不得。

也有人说，快慢本无优劣，要紧的是知道什么该快、什么该慢。

以上材料引发了你怎样的联想和思考？请写一篇文章。

要求：结合材料，选好角度，确定立意，明确文体，自拟标题；不要套作，不得抄袭；不得泄露个人信息；不少于 800 字。`,
  },
}

/** 语文试卷的大题结构：sectionId → 题号与分值（与 CHINESE_QUESTIONS 的 id 一一对应） */
const CHINESE_SECTIONS: Array<{
  id: number
  title: string
  rows: Array<[number, number]>
}> = [
  { id: 401, title: '一、现代文阅读（一）信息类文本阅读', rows: [[9223, 3], [9224, 3], [9225, 3], [9226, 4], [9227, 6]] },
  { id: 402, title: '二、现代文阅读（二）文学类文本阅读', rows: [[9228, 3], [9229, 4], [9230, 4], [9231, 5]] },
  {
    id: 403,
    title: '三、古代诗文阅读（一）文言文阅读',
    rows: [[9232, 3], [9233, 3], [9234, 3], [9235, 8], [9236, 3]],
  },
  { id: 404, title: '三、古代诗文阅读（二）古代诗歌阅读', rows: [[9237, 3], [9238, 6]] },
  { id: 405, title: '三、古代诗文阅读（三）名篇名句默写', rows: [[9239, 6]] },
  { id: 406, title: '四、语言文字运用（一）', rows: [[9240, 4], [9241, 4]] },
  { id: 407, title: '四、语言文字运用（二）', rows: [[9242, 4], [9243, 5], [9244, 3]] },
  { id: 408, title: '五、写作', rows: [[9245, 60]] },
]

/* ==================================================================
   三、英语（全国卷结构）· 81 题 / 150 分
   听力 30 + 阅读 40 + 语言知识运用 45 + 写作 35
   ================================================================== */

const ENGLISH: PaperBase = { subject: '英语', grade: '高三', categoryId: 14, owner: '周雪', ownerId: 104 }

/** 听力第一节 5 题 */
const LISTENING_A: Array<[number, string, string[], string, string]> = [
  [
    9246,
    'What will the woman do this weekend?',
    ['Visit a museum.', 'Go hiking.', 'Stay at home.'],
    'B',
    'W: Are you free this weekend? I was thinking of visiting the new museum.\nM: The museums are always crowded at weekends. Why not go hiking instead? The weather will be perfect.\nW: Good idea. I will ask my sister to come along.\n（女子本想周末去博物馆，男子建议去爬山，女子接受了 → 故选 B。）',
  ],
  [
    9247,
    'How much will the man pay for the tickets?',
    ['$15.', '$30.', '$45.'],
    'C',
    'M: Three tickets for the evening show, please.\nW: They are fifteen dollars each.\nM: Here is forty-five dollars.\n（买三张票，每张 15 美元，共 45 美元 → 故选 C。）',
  ],
  [
    9248,
    'Where does the conversation most probably take place?',
    ['In a library.', 'In a hospital.', 'In a restaurant.'],
    'C',
    'M: A table for two by the window, please.\nW: Certainly, sir. Here is the menu. Would you like something to drink first?\n（要窗边的双人桌、递上菜单、先问饮料 → 餐厅场景，故选 C。）',
  ],
  [
    9249,
    'What is the man\'s problem?',
    ['He has missed his train.', 'He has lost his ticket.', 'He has forgotten the time.'],
    'A',
    'M: Has the 8:30 train to Brighton left yet?\nW: I am afraid it left ten minutes ago. The next one is at 9:15.\nM: Oh no. I will be late for the meeting.\n（8:30 的车十分钟前已开走 → 误了火车，故选 A。）',
  ],
  [
    9250,
    'What does the woman suggest the man do?',
    ['Take a taxi.', 'Call a friend.', 'Wait for the next bus.'],
    'C',
    'M: I have been waiting for the bus for twenty minutes. I will be late for class.\nW: The buses are always slow at this hour. You may as well wait for the next one; it is only five minutes away.\n（女子：不如等下一班，五分钟就到 → 故选 C。）',
  ],
]

/** 听力第二节 15 题（第 6～20 题） */
const LISTENING_B: Array<[number, string, string[], string, string]> = [
  [
    9251,
    'What is the weather like today?',
    ['Sunny.', 'Rainy.', 'Cloudy.'],
    'B',
    'W: I thought it would be sunny today.\nM: The radio said it would clear up in the afternoon, but the rain will last till noon.\n（男子说雨要到中午才停 → 今天有雨，故选 B。）',
  ],
  [
    9252,
    'What will the speakers do tonight?',
    ['See a film.', 'Play chess.', 'Read at home.'],
    'A',
    'W: Shall we play chess tonight?\nM: The new film by that director opens tonight. Let us go and watch it.\nW: All right. I will book the tickets online.\n（男子提议去看新片，女子同意并订票 → 故选 A。）',
  ],
  [
    9253,
    'Where does the conversation take place?',
    ['In a library.', 'In a bookstore.', 'In a classroom.'],
    'A',
    'W: Excuse me, I am looking for a Chinese-English dictionary.\nM: The reference books are over there, but all the copies are out at the moment.\n（找词典、馆藏图书都借出了 → 图书馆，故选 A。）',
  ],
  [
    9254,
    'What book does the woman want?',
    ['A novel.', 'A dictionary.', 'A magazine.'],
    'B',
    'W: Excuse me, I am looking for a Chinese-English dictionary.\nM: The reference books are over there, but all the copies are out at the moment.\n（女子要找的是汉英词典 → 故选 B。）',
  ],
  [
    9255,
    'What will the man do for the woman?',
    ['Order a copy for her.', 'Lend her his own book.', 'Show her another shelf.'],
    'B',
    'W: Oh, but I need it this afternoon.\nM: You can have mine if you like. I am not using it today.\n（男子把自己的那本借给她 → 故选 B。）',
  ],
  [
    9256,
    'Where did the man work last summer?',
    ['In a hotel.', 'In a bookstore.', 'In a language school.'],
    'A',
    'W: Did you take a part-time job last summer?\nM: Yes, I worked at the front desk of a hotel near the station for two months.\n（男子在车站附近一家酒店的前台工作 → 故选 A。）',
  ],
  [
    9257,
    'What did the man learn from his summer job?',
    ['How to save money.', 'How to get along with people.', 'How to speak a foreign language.'],
    'B',
    'W: What did you get from the experience?\nM: I learned how to deal with all kinds of guests and how to work with my colleagues. Meeting people was worth more than the pay.\n（学会了与各种客人和同事打交道 → 故选 B。）',
  ],
  [
    9258,
    'What will the woman do this summer?',
    ['Work in a hotel.', 'Travel to Yunnan.', 'Volunteer at a library.'],
    'C',
    'W: That sounds good. I am thinking of volunteering at the city library this summer.\n（女子打算去市图书馆做志愿 → 故选 C。）',
  ],
  [
    9259,
    'What did the man do last Friday?',
    ['He visited a museum.', 'He attended a lecture.', 'He went to a concert.'],
    'B',
    'W: How was the lecture you went to last Friday?\n（女子问的是他上周五听的讲座 → 故选 B。）',
  ],
  [
    9260,
    'How did the man feel about it?',
    ['Bored.', 'Inspired.', 'Confused.'],
    'B',
    'M: I expected it to be boring, but it was the most inspiring talk I have ever heard. I am going to read more about space travel.\n（本以为无聊，结果深受启发 → 故选 B。）',
  ],
  [
    9261,
    'What is the woman going to write about?',
    ['Her travel experience.', 'Her school life.', 'Her favourite book.'],
    'A',
    'W: I have to write about my travel experience for the English composition, so I will look through my photos of Yunnan.\n（女子要写自己的旅行经历 → 故选 A。）',
  ],
  [
    9262,
    'What is the speaker mainly talking about?',
    ['A school sports meeting.', 'A new playground.', 'A school club.'],
    'A',
    'M: Good morning, everyone. I have an announcement about this year\'s school sports meeting…\n（通知的开头即点明主题是校运动会 → 故选 A。）',
  ],
  [
    9263,
    'When will the event be held?',
    ['On Friday.', 'On Saturday.', 'On Sunday.'],
    'B',
    'M: It will be held next Saturday on the school playground.\n（下周六举行 → 故选 B。）',
  ],
  [
    9264,
    'What are students reminded to do?',
    ['To wear sports shoes.', 'To bring their ID cards.', 'To arrive before Thursday.'],
    'A',
    'M: Everyone is welcome to take part, but please remember to wear sports shoes…\n（提醒穿运动鞋 → 故选 A。）',
  ],
  [
    9265,
    'How can students sign up for the events?',
    ['By phone.', 'By email.', 'In person.'],
    'C',
    'M: If you would like to enter an event, please come to the students\' office before Thursday and sign your name on the list.\n（到学生会办公室当面报名 → 故选 C。）',
  ],
]

/** 阅读理解：短文由 section 的 material 承载，这里只列各篇的题目 */
const READING: Record<number, Array<[number, string, string[], string, string]>> = {
  /* A 篇 */
  603: [
    [
      9266,
      'Why did Okada begin collecting bicycles?',
      ['To sell them for money.', 'To give them to children in need.', 'To take part in a competition.', 'To teach children how to repair them.'],
      'B',
      '"…she began collecting abandoned bicycles in her neighbourhood and repairing them for children who had none." 她修好后送给没有自行车的孩子 → 故选 B。',
    ],
    [
      9267,
      'What do we know about the workshop?',
      ['It is run by the local government.', 'It charges only a small fee.', 'It is mainly staffed by volunteers.', 'It repairs bicycles for adults.'],
      'C',
      '"The workshop is run entirely by volunteers, most of them students." 完全由志愿者运营，其中多数是学生 → 故选 C。',
    ],
    [
      9268,
      'Why does the group hold free repair classes?',
      ['To raise money for new bikes.', 'To help children look after their own bikes.', 'To train more volunteers.', 'To sell second-hand parts.'],
      'B',
      '"…teaching children to look after their own bikes — so that they don\'t have to come back to us." 目的是让孩子学会自己保养车子 → 故选 B。',
    ],
  ],
  /* B 篇 */
  604: [
    [
      9269,
      'What did the study compare?',
      ['Two cities in Asia.', 'Two streets in one neighbourhood.', 'Old and new buildings.', 'Two kinds of trees.'],
      'B',
      '"…measured the temperature of two streets in the same neighbourhood: one lined with old rain trees, the other bare." 比较的是同一片区的两条街道 → 故选 B。',
    ],
    [
      9270,
      'How are trees described in official documents now?',
      ['As decoration.', 'As infrastructure.', 'As a building cost.', 'As a tourist attraction.'],
      'B',
      '"Trees are now described in official documents as \'infrastructure\', the same word used for roads and drains." → 故选 B。',
    ],
    [
      9271,
      'What is the builders\' attitude towards protecting large trees?',
      ['Doubtful.', 'Supportive.', 'Indifferent.', 'Curious.'],
      'A',
      '"Not everyone is convinced. Builders argue that protecting large trees delays projects and pushes up costs." 建筑方认为保护大树拖慢工期、抬高成本，可见持怀疑态度 → 故选 A。',
    ],
    [
      9272,
      'What do the planners mean by their answer in the last paragraph?',
      ['Trees cost less than roads.', 'Cutting down trees saves time.', 'The value of trees cannot be measured by cost alone.', 'New buildings should replace old trees.'],
      'C',
      '"…a tree takes fifty years to grow but less than an hour to cut down — a point that no budget sheet can capture." 规划者强调的是树木的价值无法只用成本账来衡量 → 故选 C。',
    ],
  ],
  /* C 篇 */
  605: [
    [
      9273,
      'What has the radio programme achieved?',
      ['It has replaced school textbooks.', 'More young people can speak Sámi.', 'It has moved to southern Norway.', 'Sámi songs are no longer broadcast.'],
      'B',
      '"…the number of young people who can hold a conversation in the language has risen for the first time in sixty years." → 故选 B。',
    ],
    [
      9274,
      'What does Risten think is the key to saving a language?',
      ['Grammar books.', 'Government funding.', 'Its use in daily life.', 'Popular songs.'],
      'C',
      '"A language is not saved by grammar books… It is saved when people need it to borrow a hammer from a neighbour." 语言要在日常生活里被使用才能活下来 → 故选 C。',
    ],
    [
      9275,
      'What is said about the programme\'s budget?',
      ['It has grown quickly.', 'It is larger than a textbook project\'s.', 'It is very small.', 'It comes from the listeners.'],
      'C',
      '"Its budget today is smaller than that of a single school textbook project." 预算比一个教材项目还少，可见经费很少 → 故选 C。',
    ],
    [
      9276,
      'What can be the best title for the text?',
      ['Grammar Comes First', 'A Radio Show That Brought a Language Back', 'How to Borrow a Hammer in Norway', 'The Decline of Sámi in the North'],
      'B',
      '全文讲一档萨米语广播节目让这门语言重新回到年轻人中间，B 项最能概括主旨；A、C 只涉及文中细节，D 与文意相反。',
    ],
  ],
  /* D 篇 */
  606: [
    [
      9277,
      'When can the public visit the centre?',
      ['On Tuesdays.', 'On Thursdays.', 'At weekends.', 'Every day.'],
      'C',
      '"…opens its doors to school groups every Tuesday and Thursday, and to the public at weekends." 周二、周四接待学校团体，公众参观在周末 → 故选 C。',
    ],
    [
      9278,
      'What do the bird-watching hut and the laboratory require?',
      ['A guide.', 'An extra fee.', 'A student card.', 'Booking two weeks ahead.'],
      'A',
      '"The bird-watching hut and the working laboratory are open only with a guide." 必须有导游带领 → 故选 A。',
    ],
    [
      9279,
      'What happens to school groups of more than thirty?',
      ['They are refused.', 'They are divided into two.', 'They must come at weekends.', 'They must pay more.'],
      'B',
      '"Groups of more than thirty will be divided into two, as the laboratory can hold no more than fifteen people at a time." → 故选 B。',
    ],
    [
      9280,
      'What should weekend visitors do for the guided walk?',
      ['Book online in advance.', 'Pay at the entrance.', 'Come early, as places are limited.', 'Bring their own guide.'],
      'C',
      '"Booking is not required, but each walk is limited to twenty people." 不用预约但每场限二十人，所以要早到 → 故选 C。',
    ],
  ],
  /* 第二节 E 篇 */
  607: [
    [
      9281,
      'What is said about the loudest person in an office?',
      ['He does most of the work.', 'He is more likely to be noticed.', 'He is better at his job.', 'He often helps others quietly.'],
      'B',
      '"In many offices the loudest person in the room is remembered, while the person who quietly fixes the problem is not." 嗓门最大的人更容易被记住 → 故选 B。',
    ],
    [
      9282,
      'What did the study of 200 teams find?',
      ['Help given in private was rated lower.', 'Meetings were the best place to work.', 'Most quiet help was rewarded.', 'Managers disliked being reminded of deadlines.'],
      'A',
      '"…members who answered a colleague\'s question in a private message… were rated lower than colleagues who raised the same points in a meeting." → 故选 A。',
    ],
    [
      9283,
      'What was the effect of the researchers\' suggestion?',
      ['Reviews became shorter.', 'More workers left their teams.', 'Invisible work began to appear in reviews.', 'Fewer problems were solved.'],
      'C',
      '"In the teams that tried it, invisible work began to appear in reviews, and the people doing it were more likely to stay for another year." → 故选 C。',
    ],
    [
      9284,
      'What does the last paragraph suggest?',
      ['Quiet workers should be praised loudly.', 'How we look at work decides what we see.', 'Meetings should be held less often.', 'Private messages should be avoided.'],
      'B',
      '"…the way we look at work decides whether we can see it at all." 作者强调看待工作的方式决定了我们能否看见它 → 故选 B。',
    ],
    [
      9285,
      'Where is the text most likely from?',
      ['A business magazine.', 'A travel guide.', 'A science textbook.', 'A personal diary.'],
      'A',
      '文章讨论职场中「隐形劳动」如何被评价、企业如何改进考核，属于职场管理话题 → 最可能出自商业杂志，故选 A。',
    ],
  ],
}

/** 完形填空：材料里的 (41)～(60) 与这里的选项一一对应 */
const CLOZE: Array<[number, string[], string, string]> = [
  [9286, ['rule', 'dream', 'hobby', 'lesson'], 'A', '下文直接给出内容「be patient, and never talk」，这是他唯一的「规矩」，故选 A。'],
  [9287, ['everything', 'something', 'nothing', 'anything'], 'C', '与后半句 but I learned to sit still 形成对比：鱼几乎没钓到，收获的是耐心 → nothing。'],
  [9288, ['wide', 'dirty', 'quiet', 'cold'], 'B', '与 and the fish gone 并列，说明城市河道环境变差，dirty 最合语境。'],
  [9289, ['picked up', 'put away', 'looked for', 'threw away'], 'A', '与后半句 scrolling until my eyes hurt 呼应：拿起手机一直刷 → picked up。'],
  [9290, ['take', 'send', 'follow', 'leave'], 'A', 'take sb to the river 表示「带某人去河边」，与下文两人一起坐在岸边相符。'],
  [9291, ['covered', 'felt', 'struck', 'drank'], 'B', '用手「触摸」水面试探，felt 最贴合这个温情的细节。'],
  [9292, ['again', 'alone', 'earlier', 'instead'], 'B', '父亲去世后「独自」再去河边，与后文 I would… sit for an hour 的独处相呼应。'],
  [9293, ['check', 'charge', 'lose', 'turn off'], 'D', '要静坐一小时、什么也不钓，对应「关掉手机」→ turn off。'],
  [9294, ['forget', 'understand', 'doubt', 'explain'], 'B', 'it took me a long time to understand… 用了很久才「明白」父亲真正给的是什么 → understand。'],
  [9295, ['count', 'save', 'fear', 'spend'], 'D', 'spend the hours 表示「度过时光」，与下句 without counting them 搭配自然。'],
  [9296, ['counting', 'enjoying', 'changing', 'losing'], 'A', '全文主旨是学会「不去数着时间」地度过时光 → without counting them。'],
  [9297, ['tells', 'helps', 'allows', 'warns'], 'A', 'The world now tells me to hurry：外部世界「要求」我快点，tells 最直接。'],
  [9298, ['quiet', 'busy', 'calm', 'safe'], 'B', 'Every screen is designed to keep me busy 与上句「催我快」一致，也是后文「河边才有安静」的对照。'],
  [9299, ['short', 'slow', 'lost', 'bought'], 'B', '与上文的 hurry 构成对照：时间也可以是「慢的」→ slow。'],
  [9300, ['pace', 'cost', 'risk', 'season'], 'A', 'at their own pace 是固定搭配，指按各自的节奏生长。'],
  [9301, ['song', 'voice', 'answer', 'question'], 'B', 'heard my father\'s voice come out of my own mouth 指父亲的话从自己嘴里说出来 → voice。'],
  [9302, ['always', 'never', 'often', 'sometimes'], 'B', '与第一段父亲唯一的规矩 be patient, and never talk 前后照应 → never。'],
  [9303, ['believe', 'stop', 'blame', 'teach'], 'C', '女儿只坚持了十分钟，我没有「责骂」她，与下文 There will be other Sundays 的宽容一致。'],
  [9304, ['after all', 'by the way', 'in return', 'at last'], 'A', 'the river, after all, is still there 中的 after all 表示「毕竟」，用来收束全文。'],
  [9305, ['story', 'problem', 'point', 'reason'], 'C', 'the whole point of it 意为「这正是它的意义所在」，是全文的点题。'],
]

/** 语法填空：材料里的 (61)～(70) 与这里的答案一一对应 */
const GRAMMAR: Array<[number, string, string]> = [
  [9306, 'was added', '主语 paper-cutting 与 add 是被动关系，且时间为 2009 年，故用一般过去时的被动语态 was added。'],
  [9307, 'were used', '主语 paper-cuts 为复数，与 use 是被动关系，时间状语 In the past 指向一般过去时 → were used。'],
  [9308, 'requires', '主语 the skill 为第三人称单数，全文用一般现在时陈述事实 → requires。'],
  [9309, 'who', '非限制性定语从句缺主语，先行词 Wang Xiuying 指人 → who（不能用 that）。'],
  [9310, 'faster', 'than 提示比较级 → faster。'],
  [9311, 'will survive', 'as long as 引导条件状语从句，从句用一般现在时，主句表示将来的结果 → will survive。'],
  [9312, 'born', 'be born in 为固定搭配，此处作后置定语，用过去分词 born。'],
  [9313, 'seeing', 'a way of doing sth，of 后接动名词 → seeing。'],
  [9314, 'will be shown', '主语 works 与 show 是被动关系，时间状语 next month 指向将来 → 一般将来时的被动语态 will be shown。'],
  [9315, 'an', 'interest 为不可数名词，take an interest in 是固定短语，故填不定冠词 an。'],
]

/** 短文改错 10 题的答案与解析（题号 71～80，与 material 中带编号的十行一一对应） */
const CORRECTION_ANSWERS: Array<[string, string]> = [
  ['此行无错误，画 √', 'I am writing to thank you for your help in the past three years. 主谓一致、搭配与介词用法均无误。'],
  ['删去多余的 the：in the class → in class', 'in class 是固定短语，意为「在课堂上」，不与定冠词连用。'],
  ['help → helping：spend time doing sth', 'spend one\'s spare time doing sth 为固定结构，故 help 应改为 helping。'],
  ['删去多余的 a：made a great progress → made great progress', 'progress 是不可数名词，不能用不定冠词 a 修饰。'],
  ['take → took：Last month I took part in', '时间状语 Last month 指向过去，谓语用一般过去时。'],
  ['good → well：done it so well', '修饰动词 done 应用副词 well，而非形容词 good。'],
  ['删去多余的 am：I am plan to study → I plan to study', 'plan 在此为实义动词，与主语构成主谓结构，不能用 be 动词。'],
  ['patiently → patient：as patient and helpful as', 'as…as 之间应用形容词 patient，与并列的 helpful 保持一致。'],
  ['此行无错误，画 √', 'Please accept my sincere thanks. 用词与句法均无误。'],
  ['see → seeing：look forward to seeing you', 'look forward to 中的 to 是介词，后接动名词 seeing。'],
]

const ENGLISH_QUESTIONS: OrgQuestion[] = [
  ...LISTENING_A.map(([id, stem, options, answer, analysis]) =>
    seedQuestion(ENGLISH, { id, stem, options, answer, analysis, type: '单选题', difficulty: '容易', knowledge: ['听力理解'] }),
  ),
  ...LISTENING_B.map(([id, stem, options, answer, analysis]) =>
    seedQuestion(ENGLISH, { id, stem, options, answer, analysis, type: '单选题', difficulty: '中等', knowledge: ['听力理解'] }),
  ),
  ...Object.values(READING)
    .flat()
    .map(([id, stem, options, answer, analysis]) =>
      seedQuestion(ENGLISH, { id, stem, options, answer, analysis, type: '单选题', difficulty: '中等', knowledge: ['阅读理解'] }),
    ),
  ...CLOZE.map(([id, options, answer, analysis]) =>
    seedQuestion(ENGLISH, { id, stem: '', options, answer, analysis, type: '单选题', difficulty: '中等', knowledge: ['完形填空'] }),
  ),
  ...GRAMMAR.map(([id, answer, analysis]) =>
    seedQuestion(ENGLISH, { id, stem: '', answer, analysis, type: '填空题', difficulty: '中等', knowledge: ['时态语态'] }),
  ),
  ...Array.from({ length: 10 }, (_, i) => {
    const no = 71 + i
    const [answer, analysis] = CORRECTION_ANSWERS[i]
    return seedQuestion(ENGLISH, {
      id: 9316 + i,
      stem: '',
      answer,
      analysis,
      type: '填空题',
      difficulty: '较难',
      knowledge: [no % 2 ? '从句' : '时态语态'],
    })
  }),
  seedQuestion(ENGLISH, {
    id: 9326,
    stem: '假定你是李华，请根据下面的提示给外教 Chris 写一封邮件。（25 分）',
    type: '解答题',
    answer: `One possible version:

Dear Chris,

I am writing to invite you to be a judge at our English speaking competition, which will be held in the school hall from 2:00 to 5:00 p.m. on October 18th.

Twenty students will give five-minute speeches on the theme "Traditional Skills in a Modern City", and each speaker will answer one question from the judges. Since you have been teaching us English for two years, we would be honoured to have your comments on their pronunciation and delivery.

Would you like the students to send you their speech topics in advance, or would you prefer to hear them for the first time on the day? Please let me know so that we can make the necessary arrangements.

I am looking forward to your reply.

Yours,
Li Hua`,
    analysis:
      '本题考查应用文写作（邀请信）。评分要点：①开篇说明写信目的并发出邀请；②交代比赛的时间、地点与形式（主题、每人时长、提问环节）；③询问是否需要学生提前提交材料。语言上应注意书信格式完整、要点齐全、时态与语态正确，并适当使用定语从句、非谓语等结构使行文连贯。词数不足 80 或超出 120 酌情扣分。',
    knowledge: ['书面表达'],
  }),
]

/** 英语各大题的材料：阅读短文、完形填空（含 41～60 空）、语法填空（含 61～70 空）、短文改错（10 行）、书面表达提示 */
const ENGLISH_MATERIALS: Record<number, { hint?: string; material?: string }> = {
  601: {
    hint: '第一节　听下面 5 段对话。每段对话后有一个小题，从题中所给的 A、B、C 三个选项中选出最佳选项。听完每段对话后，你都有 10 秒钟的时间来回答有关小题和阅读下一小题。每段对话仅读一遍。',
  },
  602: {
    hint: '第二节　听下面 5 段对话或独白。每段对话或独白后有几个小题，从题中所给的 A、B、C 三个选项中选出最佳选项。听每段对话或独白前，你将有时间阅读各个小题，每小题 5 秒钟；听完后，各小题将给出 5 秒钟的作答时间。每段对话或独白读两遍。',
  },
  603: {
    hint: '阅读下列短文，从每题所给的四个选项中选出最佳选项。',
    material: `When Maya Okada was twelve, she began collecting abandoned bicycles in her neighbourhood and repairing them for children who had none. What started as a weekend hobby has grown into a small workshop in Osaka that has given away more than 3,000 bicycles.

"Most of the bikes are thrown away only because a brake or a tyre is worn out," Okada says. "A few hours of work can turn waste into somebody's first ride to school."

The workshop is run entirely by volunteers, most of them students. They keep records of every bicycle they receive and of every child who gets one. Last spring the group began to hold free repair classes, teaching children to look after their own bikes — "so that they don't have to come back to us," as Okada puts it.

The idea has spread. Seven schools in the city now run similar workshops, and Okada, who is now twenty-six, hopes the model will travel beyond Japan.`,
  },
  604: {
    hint: '阅读下列短文，从每题所给的四个选项中选出最佳选项。',
    material: `For years, city planners in Singapore treated trees as decoration. Then came a study that measured the temperature of two streets in the same neighbourhood: one lined with old rain trees, the other bare. On a hot afternoon, the shaded street was up to 5°C cooler, and the shops along it attracted about a third more visitors.

The finding changed the way the city spends its money. Trees are now described in official documents as "infrastructure", the same word used for roads and drains, and every new building must show how it will add shade rather than take it away.

Not everyone is convinced. Builders argue that protecting large trees delays projects and pushes up costs. Planners answer that a tree takes fifty years to grow but less than an hour to cut down — a point that, they say, no budget sheet can capture.`,
  },
  605: {
    hint: '阅读下列短文，从每题所给的四个选项中选出最佳选项。',
    material: `Nobody expected a language to be saved by a radio programme. But in northern Norway a weekly half-hour show in Sámi has become the most listened-to broadcast in three villages, and the number of young people who can hold a conversation in the language has risen for the first time in sixty years.

The programme's host, Elle Risten, began with songs and weather reports. Listeners wrote in asking for everyday words they had never learned: how to say "pass me the salt", how to complain about the wind. "A language is not saved by grammar books," she says. "It is saved when people need it to borrow a hammer from a neighbour."

Funding for the programme was cut twice before it became popular. Its budget today is smaller than that of a single school textbook project. Risten now spends part of each show reading out messages sent in by listeners, in the language, for no reason other than that they asked her to.`,
  },
  606: {
    hint: '阅读下列短文，从每题所给的四个选项中选出最佳选项。',
    material: `The Riverbank Study Centre opens its doors to school groups every Tuesday and Thursday, and to the public at weekends. Entry to the exhibition hall is free. The bird-watching hut and the working laboratory are open only with a guide.

School groups: please book at least two weeks in advance. Groups of more than thirty will be divided into two, as the laboratory can hold no more than fifteen people at a time. Teachers are asked to bring their own materials; a projector and a whiteboard are provided.

Weekend visitors: guided walks start at 9:00 a.m. and 2:00 p.m. and last about ninety minutes. Booking is not required, but each walk is limited to twenty people. Dogs are not allowed on the reserve, and picnic areas are marked on the map at the entrance.`,
  },
  607: {
    hint: '阅读下面短文，从每题所给的四个选项中选出最佳选项。',
    material: `In many offices the loudest person in the room is remembered, while the person who quietly fixes the problem is not. This is the "invisible work" problem, and it costs companies a great deal.

A study of 200 teams found that members who answered a colleague's question in a private message, corrected a spreadsheet, or reminded a manager of a deadline were rated lower than colleagues who raised the same points in a meeting. Only 12% of such help was ever mentioned in performance reviews.

The researchers suggest a simple change: ask each member to list, once a month, one problem they solved for someone else. In the teams that tried it, invisible work began to appear in reviews, and the people doing it were more likely to stay for another year.

The lesson is not that quiet work should be praised more loudly, but that the way we look at work decides whether we can see it at all.`,
  },
  608: {
    hint: '阅读下面短文，从短文后各题所给的四个选项中，选出可以填入空白处的最佳选项。',
    material: `When I was nine, my father taught me to fish in the river behind our house. He had only one (41)______: be patient, and never talk. For two summers I caught almost (42)______, but I learned to sit still.

Years later I moved to a city where the rivers were (43)______ and the fish gone, and I stopped fishing. I worked late, and on my rare free days I (44)______ my phone, scrolling until my eyes hurt.

Then my father fell ill. On one of his last good days he asked me to (45)______ him to the river. We sat on the bank as we used to, and he (46)______ the water with his hand. "Still here," he said, meaning the river, meaning us.

After he died I began to go there (47)______. I would (48)______ my phone, sit for an hour, and catch nothing at all. It took me a long time to (49)______ what he had really given me: not a way to catch fish, but a way to (50)______ the hours without (51)______ them.

The world now (52)______ me to hurry. Every screen is designed to keep me (53)______. But in the silence by the river I remember that time can also be (54)______, and that some things — a tree, a friendship, a language — grow only at their own (55)______.

My daughter is seven now. Last Sunday she asked me to teach her to fish. I handed her a rod and, for the first time in years, heard my father's (56)______ come out of my own mouth: "Be patient, and (57)______ talk." She lasted about ten minutes. I did not (58)______ her. There will be other Sundays, and the river, (59)______, is still there — which is, I have come to think, the whole (60)______ of it.`,
  },
  609: {
    hint: '阅读下面短文，在空白处填入 1 个适当的单词或括号内单词的正确形式。',
    material: `The Chinese art of paper-cutting is more than a thousand years old. In 2009 it (61)______ (add) to UNESCO's list of intangible cultural heritage.

In the past, paper-cuts (62)______ (use) to decorate windows and doors, especially during the Spring Festival. Today they appear on cards, clothes and even buildings. A paper-cut is made with a small knife or a pair of scissors, and the skill (63)______ (require) years of practice.

Wang Xiuying, (64)______ has been cutting paper for forty years, teaches the craft in a primary school in Shaanxi. "Children learn (65)______ (fast) than adults," she says. "But they give up more easily."

She believes that paper-cutting (66)______ (survive) as long as it is taught in schools. Her own teacher, (67)______ (bear) in 1930, learned the craft from her mother. "It is not only a skill," Wang says. "It is a way of (68)______ (see) the world."

Her students' works (69)______ (show) in a small hall next month. Wang hopes that more young people will take (70)______ interest in the art.`,
  },
  610: {
    hint: '此题要求改正所给短文中的错误。对标有题号的每一行作出判断：如无错误，在该行右边横线上画一个勾（√）；如有错误（每行只有一个错误），则按下列情况改正：此行多一个词，把多余的词用斜线（\\）划掉；此行缺一个词，在缺词处加一个漏字符号（∧）并写出该加的词；此行错一个词，在错的词下画一横线并写出改正后的词。',
    material: `Dear Mr. Li,

I am writing to thank you for your help in the past three years. (71)
When I first came to this school, I was too shy to speak in the class. (72)
You were so kind that you often spent your spare time help me with my English. (73)
Thanks to your encouragement, I have made a great progress. (74)
Last month I take part in an English speech contest and won the second prize. (75)
Without your help, I could not have done it so good. (76)
Now I am plan to study English in a university and become a teacher like you. (77)
I hope I can be as patiently and helpful as you are when I stand in front of my own students. (78)
Please accept my sincerely thanks. (79)
I am looking forward to see you again. (80)

Yours,
Li Hua`,
  },
  611: {
    hint: '书面表达：请根据下面的提示写一封邮件。',
    material: `假定你是李华，你校英语社团将在下月举办以 "Traditional Skills in a Modern City" 为主题的英语演讲比赛。请你给外教 Chris 写一封邮件，内容包括：

1. 邀请他担任评委；
2. 说明比赛的时间、地点与形式；
3. 询问他是否需要学生提前提交演讲主题。

注意：1. 词数 100 左右；2. 可以适当增加细节，以使行文连贯。`,
  },
}

/* ==================================================================
   试卷：语文 / 数学 / 英语 各一套
   ================================================================== */

function makeSections(rows: Array<{ id: number; title: string; rows: Array<[number, number]> }>, materials: Record<number, { hint?: string; material?: string }> = {}): PaperSection[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    questions: row.rows.map(([questionId, score]) => ({ questionId, score })),
    ...(materials[row.id] ?? {}),
  }))
}

export const EXAM_QUESTIONS: OrgQuestion[] = [...CHINESE_QUESTIONS, ...MATH_QUESTIONS, ...ENGLISH_QUESTIONS]

export const EXAM_PAPERS: OrgPaper[] = [
  {
    id: 313,
    name: '2026 年高考模拟卷 · 语文（新课标 I 卷）',
    subject: '语文',
    grade: '高三',
    duration: 150,
    status: 'approved',
    sections: makeSections(CHINESE_SECTIONS, CHINESE_MATERIALS),
    owner: '吴刚',
    updatedAt: '2026-09-21 09:15:00',
    sharedSquare: true,
  },
  {
    id: 314,
    name: '2026 年高考模拟卷 · 数学（新高考 I 卷）',
    subject: '数学',
    grade: '高三',
    duration: 120,
    status: 'approved',
    sections: makeSections([
      { id: 501, title: '一、单项选择题（8 小题，每小题 5 分，共 40 分）', rows: [[9201, 5], [9202, 5], [9203, 5], [9204, 5], [9205, 5], [9206, 5], [9207, 5], [9208, 5]] },
      { id: 502, title: '二、多项选择题（4 小题，每小题 5 分，共 20 分）', rows: [[9209, 5], [9210, 5], [9211, 5], [9212, 5]] },
      { id: 503, title: '三、填空题（4 小题，每小题 5 分，共 20 分）', rows: [[9213, 5], [9214, 5], [9215, 5], [9216, 5]] },
      {
        id: 504,
        title: '四、解答题（6 小题，共 70 分）',
        rows: [[9217, 10], [9218, 12], [9219, 12], [9220, 12], [9221, 12], [9222, 12]],
      },
    ]),
    owner: '陈明远',
    updatedAt: '2026-09-22 10:40:00',
    sharedSquare: false,
  },
  {
    id: 315,
    name: '2026 年高考模拟卷 · 英语（全国卷）',
    subject: '英语',
    grade: '高三',
    duration: 120,
    status: 'approved',
    sections: makeSections(
      [
        { id: 601, title: '第一部分 听力（第一节）', rows: [[9246, 1.5], [9247, 1.5], [9248, 1.5], [9249, 1.5], [9250, 1.5]] },
        {
          id: 602,
          title: '第一部分 听力（第二节）',
          rows: [
            [9251, 1.5], [9252, 1.5], [9253, 1.5], [9254, 1.5], [9255, 1.5],
            [9256, 1.5], [9257, 1.5], [9258, 1.5], [9259, 1.5], [9260, 1.5],
            [9261, 1.5], [9262, 1.5], [9263, 1.5], [9264, 1.5], [9265, 1.5],
          ],
        },
        {
          id: 603,
          title: '第二部分 阅读理解（第一节 A 篇）',
          rows: [[9266, 2], [9267, 2], [9268, 2]],
        },
        {
          id: 604,
          title: '第二部分 阅读理解（第一节 B 篇）',
          rows: [[9269, 2], [9270, 2], [9271, 2], [9272, 2]],
        },
        {
          id: 605,
          title: '第二部分 阅读理解（第一节 C 篇）',
          rows: [[9273, 2], [9274, 2], [9275, 2], [9276, 2]],
        },
        {
          id: 606,
          title: '第二部分 阅读理解（第一节 D 篇）',
          rows: [[9277, 2], [9278, 2], [9279, 2], [9280, 2]],
        },
        {
          id: 607,
          title: '第二部分 阅读理解（第二节）',
          rows: [[9281, 2], [9282, 2], [9283, 2], [9284, 2], [9285, 2]],
        },
        {
          id: 608,
          title: '第三部分 语言知识运用（第一节 完形填空）',
          rows: CLOZE.map(([id]) => [id, 1.5] as [number, number]),
        },
        {
          id: 609,
          title: '第三部分 语言知识运用（第二节 语法填空）',
          rows: GRAMMAR.map(([id]) => [id, 1.5] as [number, number]),
        },
        {
          id: 610,
          title: '第四部分 写作（第一节 短文改错）',
          rows: Array.from({ length: 10 }, (_, i) => [9316 + i, 1] as [number, number]),
        },
        { id: 611, title: '第四部分 写作（第二节 书面表达）', rows: [[9326, 25]] },
      ],
      ENGLISH_MATERIALS,
    ),
    owner: '周雪',
    updatedAt: '2026-09-23 08:50:00',
    sharedSquare: false,
  },
]
