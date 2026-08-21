# Images

UI 静态图片资源目录。打包进 bundle，文件名会被 Vite 加 hash，所以**不要**在这里放
按文件名硬编码引用的资源（例如 OAuth provider 的回调 icon、第三方 SDK 按文件名查找的资源）——
那种放 `public/`。

## 目录约定

按用途分子目录，避免一个 root 目录堆一堆散图：

| 子目录 | 用途 | 示例 |
| --- | --- | --- |
| `logo/` | 品牌 / logo | `logo.svg`, `logo-dark.svg` |
| `icons/` | 自定义 SVG 图标（用 Element Plus 提供的图标不用放这） | `copy.svg`, `send.svg` |
| `illustrations/` | 插画 / 空状态 / 错误页背景 | `empty-doc.svg`, `error-500.svg` |
| `backgrounds/` | 装饰背景图 | `auth-bg.webp` |

如果一张图暂时只有自己用、又归不到上面任何一类，可以先放 root，子目录空了再迁。

## 格式优先级

1. **SVG** —— 优先用。能无损缩放、改色用 `currentColor`，体积通常最小
2. **WebP** —— 位图场景优先。比 PNG/JPG 小 25–35%
3. **PNG** —— 需要透明光栅图时的兜底
4. **JPG** —— 大图、照片

文件名带格式后缀：`logo.svg` / `auth-bg.webp`，不要 `logo.png` 实际是 svg 这种误导命名。

## 怎么引用

### Vue template —— 用 `import`，享受 Vite 的 hash + tree-shake

```vue
<script setup lang="ts">
import logoUrl from '@/assets/images/logo/logo.svg'
</script>

<template>
  <img :src="logoUrl" alt="Logo" />
</template>
```

### 动态引用 —— 用 `import.meta.glob` 批量加载

```ts
// 加载 illustrations 目录下所有 svg，路径作为 key
const illustrations = import.meta.glob('@/assets/images/illustrations/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>
```

### CSS 背景 —— 也走 `import`

```ts
import authBg from '@/assets/images/backgrounds/auth-bg.webp'

// 在 <style> 里
// background-image: url('@/assets/images/backgrounds/auth-bg.webp')
// 或在 <style module> / setup 里通过变量注入
```

## 不要做的事

- ❌ 往这里放大图（>200KB）或用户上传的内容 → 应该走后端 / 对象存储
- ❌ 用字符串拼接路径：`src="/assets/images/logo/${name}.svg"` 不会走 Vite 处理
- ❌ 提交 1x / 2x / 3x 多份 retina 切图 → 现代浏览器用 `srcset` + 一个高分辨率图即可