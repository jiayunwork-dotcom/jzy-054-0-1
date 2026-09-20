# 傅里叶变换教学工具 · Fourier Lab

一个跑在浏览器里的傅里叶变换教学工具：左侧亲手叠波形 / 手绘波形，中间看 DFT 频谱、
做频域滤波，右侧对比窗函数、拖动采样率观察混叠。**前端只负责构造信号与画图，
所有频域计算都由可独立检验的 Python 后端完成。**

- 前端：TypeScript + Vite 6（Node.js 20 构建），Canvas 2D 绘图，原生 HTML 控件，无第三方 UI 框架
- 后端：Python 3.12 + FastAPI，变换内核为**纯 Python 手写 FFT/DFT**（无 numpy/scipy），可独立阅读与检验
- 编排：Docker Compose（nginx 静态托管前端并反代 `/api`）

## 快速开始

```bash
docker compose up --build
# 前端：http://localhost:8080
# 后端 API / OpenAPI 文档：http://localhost:8000  （/docs）
```

本地开发（热更新）：

```bash
# 后端（需要 Python 3.12；3.11 亦可运行测试）
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev          # http://localhost:5173 ，/api 已代理到 8000
```

## 功能对照

| 教学目标 | 界面位置 | 后端支撑 |
| --- | --- | --- |
| 叠加 ≤8 个正弦/余弦/方波/三角波/锯齿波，调振幅、频率、初相 | ① 信号构造 | 前端按 fs 采样 |
| 鼠标手绘任意波形，按当前 N/fs 离散化 | ① 手绘模式 | 前端线性插值重采样 |
| 选 N∈{64,128,256,512,1024} 与采样率，取幅度/相位/功率谱 | ② DFT | `POST /api/dft` |
| 尾部补零观察频谱插值细化 | ① 补零到 N' | `n` 参数零延拓 |
| 矩形/汉宁/汉明/布莱克曼/β 可调凯泽窗，换窗即重算 | ② 窗选择 | `core/windows.py` |
| 各窗主瓣宽度(bin)/最高旁瓣(dB) 小表 + 多色谱叠加 | 右侧 窗对比 | `POST /api/windows/compare` |
| 采样定理：密集原信号 + 离散点 + sinc 重建，混叠显著标红 | ③ 采样定理 | `POST /api/sampling-demo`、`GET /api/alias` |
| 频谱上框选频段，低通/高通/带通，频段外置零后逆变换，时域虚线对比 | ④ 频域滤波 | `POST /api/filter` |

## 变换约定

```
正变换   X[k] = Σ_n x[n] e^{-j2πkn/N}
逆变换   x[n] = (1/N) Σ_k X[k] e^{+j2πkn/N}
帕塞瓦尔 Σ_n |x[n]|² = (1/N) Σ_k |X[k]|²
```

## 目录结构

```
backend/
  app/
    core/
      transform.py   # 手写 radix-2 FFT、直接 DFT 回退、IDFT、幅度/相位/帕塞瓦尔
      windows.py     # 五种窗函数、凯泽 β、主瓣/旁瓣指标测量（带缓存）
      filtering.py   # 共轭对称掩膜构造、频段清零与逆变换
      sampling.py    # 混叠判定、表观频率、sinc 插值重建
      validation.py  # 统一非法输入校验（400 + 明确原因）
    schemas.py       # 请求模型
    api.py           # 接口层（薄）
    main.py          # FastAPI 入口
  tests/             # pytest：变换往返、帕塞瓦尔、共轭对称、单音 bin、混叠、滤波、非法输入
frontend/
  src/
    signals.ts                    # 五种波形、分量叠加、手绘重采样
    api.ts / types.ts / state.ts  # 后端接口、类型、轻量状态
    components/
      signal-builder.ts           # ① 信号构造区
      spectrum-panel.ts           # ② 三张频谱图
      window-compare.ts           # 窗叠加对比 + 指标表
      sampling-panel.ts           # ③ 采样定理演示
      filter-panel.ts             # ④ 框选滤波与时域对比
      plot.ts                     # Canvas 绘图基础库
  test/signals.test.ts             # node:test 波形数学测试
docker-compose.yml
```

## 自动化测试

后端（覆盖所有必须成立的恒等关系与判据）：

```bash
cd backend && python -m pytest
# 68 个测试：
# - FFT 与直接 DFT 定义一致；各允许 N 正/逆变换还原（误差 < 1e-9）
# - 帕塞瓦尔时域/频域能量相等
# - 实信号频谱共轭对称 X[k]=conj(X[N-k])
# - 纯单频正弦只在对应 bin 及共轭镜像出现显著峰
# - 低/高/带通后被清除频段能量确实为 0
# - 混叠判据 f0>fs/2 与表观频率折叠公式（含高阶折叠、边界 fs/2）
# - 奈奎斯特采样下 sinc 重建恢复原信号
# - 非法 N、非正 fs、未知窗名、凯泽缺 β、补零变短、频段越界/反向等全部 400 且带原因
# - 全零信号频谱处处为 0（合法退化）
```

前端：

```bash
cd frontend && npm test    # 波形取值、分量叠加、手绘重采样
```

## 非法输入处理

以下请求都会被后端以 **HTTP 400 + 中文原因** 挡回：N 不在允许集合、采样率 ≤ 0、
窗名不认识、凯泽窗缺 β、滤波频段越过 Nyquist 或上界 ≤ 下界、补零长度短于原信号。
全零信号等合法退化情形照常返回全零结果，而不是报错。
