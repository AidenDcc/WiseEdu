/**
 * 按需依赖的类型占位：`docx`（写 .docx）与 `mammoth`（读 .docx）。
 *
 * 这两个包**不在仓库默认依赖里**（体积不小，且只有「导入 / 导出 Word」这一条通路用得到）。
 * 仓库已经把它们的版本写进 `apps/tenant/package.json` 的 dependencies ——
 * 也就是说 `pnpm install` 之后它们就在 node_modules 里了。
 *
 * 这份声明的作用只有一个：**在依赖尚未安装时也让 `vue-tsc --noEmit` 通过**，
 * 免得「先跑类型检查、后装依赖」的顺序把整条链路卡住。
 * 真实类型存在时，本声明不参与（同名模块声明与包自带的 d.ts 不冲突）。
 *
 * 注意：`vite build` 会在**打包期**解析这两个模块，那时必须已经装好依赖 ——
 * 装了才可能构建出含「导入 / 导出 Word」的产物；没装则构建会报「无法解析模块」。
 * 若确定不需要这条通路，把 `utils/doc-io.ts` 与 package.json 里的这两项一起删掉即可。
 */
declare module 'docx'
declare module 'mammoth'
