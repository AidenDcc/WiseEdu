import pca from 'china-division/dist/pca.json'

/* 省 / 市 / 区三级联动的下拉数据，喂给 Element Plus 的 el-cascader。
   ⚠️ 只从这里引 `china-division/dist/pca.json`（48K，纯名字）。**不要**引包根
      `china-division`：它的入口 `lib/export.js` 把 provinces/cities/areas/**streets/villages**
      全 require 了一遍，villages.json 一个就 81M，Vite 会照单全收打进产物。
   ⚠️ 这份数据只给管理端用（新增机构表单），因此放在 apps/admin 而不是 packages/shared：
      共享层被机构端一起引，往那儿加依赖要两端同时装包，而机构端目前不需要省市区。 */

export interface RegionOption {
  value: string
  label: string
  children?: RegionOption[]
  /* Element Plus 的 `CascaderOption` 带一根字符串索引签名（`disabled` 之类的扩展字段靠它透传）。
     结构类型下「没有索引签名的接口」赋不给它，所以这里补一根同样的。 */
  [key: string]: unknown
}

/* 四个直辖市在源数据里被塞了一层人工的「市辖区」（北京/天津/上海 的二级只有它一个，
   重庆的「市辖区」与「县」并列）。原样铺进级联选择器，用户得先点一个行政上并不存在的
   「市辖区」才能选到区 —— 多点一次、还读了个假名字。这里把这一层提上来摊平：
   北京 → 东城区 成了两级，其余省份照旧三级；重庆提上来后区与县同级，也说得通。 */
const MUNICIPAL_DISTRICT = '市辖区'

export const REGION_OPTIONS: RegionOption[] = Object.entries(pca).map(([province, cities]) => ({
  value: province,
  label: province,
  children: Object.entries(cities as Record<string, string[]>).flatMap(([city, areas]) =>
    city === MUNICIPAL_DISTRICT
      ? areas.map((area) => ({ value: area, label: area }))
      : [{ value: city, label: city, children: areas.map((area) => ({ value: area, label: area })) }],
  ),
}))

/** 级联路径 → 存进 `city` 的一行字：['湖北省','武汉市','江岸区'] → '湖北省武汉市江岸区'。
    与机构种子里既有的 `city`（'湖北省武汉市'、'上海市'）同格式：省市区连着写、不带分隔符。 */
export function regionText(path: readonly string[] | null | undefined) {
  return (path ?? []).join('')
}
