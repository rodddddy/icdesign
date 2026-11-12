/* English / Chinese interface switch. English source text is translated in place and restored on demand. */
(function () {
  'use strict';

  const STORAGE_KEY = 'icdesign-lang';
  const SKIP_ALL = 'script,style,textarea,noscript,svg,code,pre,[data-no-i18n]';
  // user-defined signal names and expressions must never be translated
  const NO_TEXT = '#tt-container th,#expression-table-container th,#expression-signals,.expression-field,'
    + '.expression-input-row label,.expr-name,.expr-html,.expr-ascii,#in-list,#out-list';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const CJK_START = /^[\u3000-\u9fff\uff00-\uffef]/;
  const CJK_END = /[\u3000-\u9fff\uff00-\uffef]$/;

  const D = {
    // shared
    "Tools": "工具",
    "Main navigation": "主导航",
    "← All tools": "← 全部工具",
    "ICDesign Lab — static site deployed on Cloudflare Pages · source on GitHub": "ICDesign Lab — 部署在 Cloudflare Pages 上的静态网站 · 源码托管于 GitHub",
    "Generate": "生成",
    "Results": "结果",
    "Select all": "全选",
    "Select none": "全不选",
    "1 input": "1 输入",
    "Download SVG": "下载 SVG",
    "Download PNG": "下载 PNG",
    "Gate-level schematic": "门级原理图",
    "Generated truth table": "生成的真值表",
    "Truth table": "真值表",
    "Cannot generate circuit": "无法生成电路",
    "Synthesis failed.": "综合失败。",

    // home
    "ICDesign Lab — IC Design Tools": "ICDesign Lab — IC 设计辅助工具",
    "Tools for": "IC 设计",
    "IC design": "辅助工具",
    "A growing set of free, open-source tools to help with everyday IC design. Runs in your browser, no installation or sign-up.": "一系列持续更新的免费开源工具，辅助日常 IC 设计。直接在浏览器中运行，无需安装或注册。",
    "Combinational Logic Generator": "组合逻辑生成器",
    "Enter a truth table, get minimized Boolean expressions and a gate-level schematic. Constrain the mapper to NAND / NOR / MUX / XOR and more.": "输入真值表，获得化简后的布尔表达式和门级原理图。可将映射限制为 NAND / NOR / MUX / XOR 等门类型。",
    "Logic Synthesis": "逻辑综合",
    "Typical Digital Circuit Generator": "典型数字电路生成器",
    "Configure adders, decoders, encoders, counters, shift registers and more. Generate gate schematics, truth tables or illustrative timing waves with your chosen gate library.": "配置加法器、译码器、编码器、计数器、移位寄存器等电路，使用所选门库生成门级原理图、真值表或示意时序波形。",
    "Combinational & Sequential": "组合与时序",
    "Basic Analog Circuit Calculator": "基础模拟电路计算器",
    "Explore eight MOS amplifier topologies with live schematics, small-signal gain, bandwidth estimates and readable model equations.": "探索八种 MOS 放大器拓扑，实时查看原理图、小信号增益、带宽估算和易读的模型公式。",
    "Analog & Small Signal": "模拟与小信号",

    // combinational logic generator
    "Combinational Logic Generator — ICDesign Lab": "组合逻辑生成器 — ICDesign Lab",
    "Define input / output signals, fill in a truth table or enter Boolean expressions, and get minimized expressions plus a gate-level schematic. Restrict the gate library to explore different implementation styles.": "定义输入/输出信号，填写真值表或输入布尔表达式，即可得到化简后的表达式和门级原理图。限制门库可探索不同的实现方式。",
    "Signals": "信号",
    "Input signals": "输入信号",
    "Output signals": "输出信号",
    "+ add input": "+ 添加输入",
    "+ add output": "+ 添加输出",
    "Gate library": "门库",
    "Only selected types and counts are used. Larger functions are split across gates; spare pins may use repeated signals or constants. Multi-input XNOR is the inverse of XOR parity.": "仅使用已选的门类型和输入数。较大的函数会拆分到多个门；多余引脚可接重复信号或常量。多输入 XNOR 为 XOR 奇偶校验的反相。",
    "Logic input": "逻辑输入",
    "Input method": "输入方式",
    "Expressions": "表达式",
    "Export Excel (.csv)": "导出 Excel (.csv)",
    "Click an input field to select an output, then click signal or operator tokens or type on your keyboard.": "点击输入框选择要编辑的输出，然后点击信号或运算符，或直接用键盘输入。",
    "Tip: SVG scales without quality loss; PNG is exported at 2× resolution.": "提示：SVG 可无损缩放；PNG 以 2 倍分辨率导出。",
    "Operators": "运算符",
    "Open parenthesis": "左括号",
    "Close parenthesis": "右括号",
    "OR (+)": "或（+）",
    "AND (*)": "与（*）",
    "NOT (postfix ')": "非（后缀 '）",
    "NOT (prefix !)": "非（前缀 !）",
    "XOR (keyboard: ^)": "异或（键盘：^）",
    "XNOR (keyboard: ~^)": "同或（键盘：~^）",
    "Constant 0": "常量 0",
    "Constant 1": "常量 1",
    "Delete": "删除",
    "Enter a Boolean expression": "输入布尔表达式",
    "constant": "常量",
    "AND/OR (SOP)": "AND/OR（积之和）",
    "XOR-merged AND/OR": "XOR 合并的 AND/OR",
    "complemented AND/OR (De Morgan)": "取反 AND/OR（德摩根）",
    "NAND-NAND": "NAND-NAND",
    "NOR-NOR": "NOR-NOR",
    "AND + INV (De Morgan)": "AND + INV（德摩根）",
    "OR + INV (De Morgan)": "OR + INV（德摩根）",
    "parity/AND (ANF)": "奇偶/AND（代数范式）",
    "MUX tree": "MUX 树",
    "Invalid signals": "信号无效",
    "No gates selected": "未选择任何门",
    "Choose at least one gate type in Step 2.": "请在第 2 步中至少选择一种门类型。",
    "PNG export failed": "PNG 导出失败",
    "The circuit image could not be encoded.": "无法编码电路图像。",
    "The circuit image could not be rendered.": "无法渲染电路图像。",
    "Enter an expression.": "请输入表达式。",
    "Expressions may contain at most 4096 characters.": "表达式最多 4096 个字符。",
    "The expression is incomplete.": "表达式不完整。",
    "Missing closing parenthesis.": "缺少右括号。",
    "Only the constants 0 and 1 are allowed": "只允许使用常量 0 和 1",
    "Unexpected closing parenthesis": "多余的右括号",
    "Expected an input, 0, 1 or an opening parenthesis": "此处应为输入信号、0、1 或左括号",
    "NOT must follow a signal or closing parenthesis": "NOT 必须跟在信号或右括号之后",
    "signal inversion requires INV, NAND, NOR, XOR or XNOR": "信号取反需要 INV、NAND、NOR、XOR 或 XNOR",
    "an AND gate is required but AND is not selected": "需要 AND 门，但未选择 AND",
    "an OR gate is required but OR is not selected": "需要 OR 门，但未选择 OR",
    "an XOR gate is required but XOR is not selected": "需要 XOR 门，但未选择 XOR",
    "a MUX is required but MUX is not selected": "需要 MUX，但未选择 MUX",
    "mapping failed": "映射失败",
    "inversion": "需要取反",
    "cannot synthesize": "无法综合",
    "No gates selected. Choose at least one gate type.": "未选择任何门。请至少选择一种门类型。",
    "The library only contains INV/BUF gates, which cannot compute any non-trivial function.": "门库仅包含 INV/BUF，无法实现任何非平凡函数。",
    "XOR alone can only implement parity (linear) functions; this truth table is not one.": "仅用 XOR 只能实现奇偶（线性）函数，而该真值表不属于此类。",
    "Hint: a complete library needs one of — AND+INV, OR+INV, NAND, NOR, XOR+AND — or MUX with (optionally) INV/NAND/NOR.": "提示：完备门库需要以下之一——AND+INV、OR+INV、NAND、NOR、XOR+AND——或 MUX（可搭配 INV/NAND/NOR）。",
    "Select XOR or XNOR to implement parity.": "请选择 XOR 或 XNOR 以实现奇偶函数。",

    // typical digital circuit generator
    "Typical Digital Circuit Generator — ICDesign Lab": "典型数字电路生成器 — ICDesign Lab",
    "Choose a circuit, adjust its options, and map it to your gate library. Get truth tables and minimized expressions for combinational logic, or a schematic and illustrative timing waves for sequential logic.": "选择电路、调整选项，并映射到你的门库。组合逻辑可得到真值表和化简表达式，时序逻辑可得到原理图和示意时序波形。",
    "Circuit & options": "电路与选项",
    "Only options relevant to the selected circuit are shown. Changing the circuit restores its defaults.": "仅显示与所选电路相关的选项。切换电路会恢复其默认设置。",
    "Circuit": "电路",
    "SR latch": "SR 锁存器",
    "Adder": "加法器",
    "Decoder": "译码器",
    "Priority encoder": "优先编码器",
    "Synchronous counter": "同步计数器",
    "Shift register": "移位寄存器",
    "Multiplexer": "多路选择器",
    "Demultiplexer": "数据分配器",
    "Code converter": "码制转换器",
    "Latch gates": "锁存器门类型",
    "NOR (active-high S, R)": "NOR（高电平有效 S、R）",
    "NAND (active-low S_N, R_N)": "NAND（低电平有效 S_N、R_N）",
    "Combinational": "组合逻辑",
    "Edge-triggered sequential": "边沿触发时序逻辑",
    "Sequential · latch": "时序 · 锁存器",
    "External inputs": "外部输入",
    "Outputs": "输出",
    "None": "无",
    "Multi-bit signals are listed most-significant bit first; index 0 is the least-significant bit (LSB).": "多位信号按最高有效位在前列出；索引 0 为最低有效位（LSB）。",
    "S = 1 sets Q; R = 1 resets Q; S = R = 0 holds. S = R = 1 is forbidden and forces both outputs to 0.": "S = 1 置位 Q；R = 1 复位 Q；S = R = 0 保持。S = R = 1 为禁止状态，会使两个输出均为 0。",
    "S_N = 0 sets Q; R_N = 0 resets Q; S_N = R_N = 1 holds. S_N = R_N = 0 is forbidden and forces both outputs to 1.": "S_N = 0 置位 Q；R_N = 0 复位 Q；S_N = R_N = 1 保持。S_N = R_N = 0 为禁止状态，会使两个输出均为 1。",
    "Release of the forbidden condition directly into hold leaves both outputs X (indeterminate) until a valid set or reset resolves the state.": "从禁止状态直接释放到保持状态时，两个输出均为 X（不确定），直到有效的置位或复位确定状态。",
    "Adder type": "加法器类型",
    "Half adder": "半加器",
    "Full adder": "全加器",
    "Adds two one-bit inputs A and B. SUM is the sum bit; COUT is the carry-out. 2 × COUT + SUM = A + B.": "将两个 1 位输入 A 和 B 相加。SUM 为和位；COUT 为进位输出。2 × COUT + SUM = A + B。",
    "Adds two one-bit inputs A and B plus carry-in CIN. SUM is the sum bit; COUT is the carry-out. 2 × COUT + SUM = A + B + CIN.": "将两个 1 位输入 A、B 与进位输入 CIN 相加。SUM 为和位；COUT 为进位输出。2 × COUT + SUM = A + B + CIN。",
    "Decoder mode": "译码器模式",
    "Binary to one-hot": "二进制转独热码",
    "Binary to thermometer code": "二进制转温度计码",
    "Address bits": "地址位数",
    "Enable input (EN)": "使能输入（EN）",
    "Output polarity": "输出极性",
    "Active-high": "高电平有效",
    "Active-low": "低电平有效",
    "Yk is selected when A = k. Selected outputs are 1; all other outputs are 0.": "A = k 时选中 Yk。选中的输出为 1，其余输出均为 0。",
    "Yk is selected when A = k. Selected outputs are 0; all other outputs are 1.": "A = k 时选中 Yk。选中的输出为 0，其余输出均为 1。",
    "EN = 0 disables every output to its inactive level; EN = 1 enables decoding.": "EN = 0 时所有输出均为无效电平；EN = 1 时启用译码。",
    "Input count": "输入数",
    "Priority": "优先级",
    "Highest index first": "最高索引优先",
    "Lowest index first": "最低索引优先",
    "State bits": "状态位数",
    "Limited to 2-6 bits to bound complete next-state truth-table synthesis.": "限制为 2-6 位，以控制完整次态真值表的综合规模。",
    "Count direction": "计数方向",
    "Up": "加计数",
    "Down": "减计数",
    "Modulus": "模",
    "Active clock edge": "有效时钟沿",
    "Rising": "上升沿",
    "Falling": "下降沿",
    "Reset": "复位",
    "Synchronous active-high": "同步高电平有效",
    "Initial waveform state": "波形初始状态",
    "Simulation only; this does not initialize physical flip-flops.": "仅用于仿真，不会初始化实际触发器。",
    "RST connects directly to each DFF synchronous active-high reset pin. RST = 1 clears Q only at the selected clock edge, with priority over D.": "RST 直接连接到每个 DFF 的同步高电平有效复位引脚。RST = 1 仅在所选时钟沿清零 Q，且优先于 D。",
    "Every DFF RST pin is tied to GND; there is no external reset or hardware initialization.": "所有 DFF 的 RST 引脚接 GND；无外部复位，也无硬件初始化。",
    "Each DFF provides Q and Q′ (the complement of Q). Q / Q′ labels are connected feedback aliases, not additional external inputs; Q′ is used directly when it simplifies the logic.": "每个 DFF 提供 Q 和 Q′（Q 的反相）。Q / Q′ 标签是相互连接的反馈别名，而非额外的外部输入；在能简化逻辑时直接使用 Q′。",
    "Waveforms are ideal logical samples without physical propagation delay; controls change away from active clock edges.": "波形为不含物理传播延迟的理想逻辑采样；控制信号在有效时钟沿以外的时刻变化。",
    "Register bits": "寄存器位数",
    "Shift direction": "移位方向",
    "Left (toward MSB)": "左移（向 MSB）",
    "Right (toward LSB)": "右移（向 LSB）",
    "Input mode": "输入模式",
    "Serial shift": "串行移位",
    "Parallel load and serial shift": "并行加载与串行移位",
    "Priority at the active edge: RST clears first, then LOAD = 1 loads Q from P; otherwise shift SI. LOAD is active-high.": "有效沿处的优先级：RST 优先清零，其次 LOAD = 1 时从 P 加载 Q；否则移入 SI。LOAD 高电平有效。",
    "Priority at the active edge: LOAD = 1 loads Q from P; otherwise shift SI. LOAD is active-high.": "有效沿处的优先级：LOAD = 1 时从 P 加载 Q；否则移入 SI。LOAD 高电平有效。",
    "Every active edge shifts SI unless RST = 1 clears the register first.": "每个有效沿都会移入 SI，除非 RST = 1 先将寄存器清零。",
    "Every active edge shifts SI.": "每个有效沿都会移入 SI。",
    "Data inputs": "数据输入数",
    "One-bit data: Y = Dk when the binary selector S = k.": "1 位数据：二进制选择信号 S = k 时 Y = Dk。",
    "Output count": "输出数",
    "1-to-2": "1 → 2",
    "1-to-4": "1 → 4",
    "1-to-8": "1 → 8",
    "Yk = D when selector S = k; every unselected output is 0.": "选择信号 S = k 时 Yk = D；所有未选中的输出均为 0。",
    "Conversion": "转换类型",
    "Binary to Gray": "二进制转格雷码",
    "Gray to binary": "格雷码转二进制",
    "BCD to excess-3": "BCD 转余 3 码",
    "Excess-3 to BCD": "余 3 码转 BCD",
    "Word bits": "字长",
    "The MSB is unchanged; each lower Gray bit is the XOR of adjacent binary bits. Every input code is valid.": "MSB 保持不变；每个较低的格雷码位是相邻二进制位的异或。所有输入编码均有效。",
    "The MSB is unchanged; each binary bit is the cumulative XOR from the Gray MSB down to that bit. Every input code is valid.": "MSB 保持不变；每个二进制位是从格雷码 MSB 到该位的累积异或。所有输入编码均有效。",
    "Fixed 4-bit words: bit 3 is the MSB. BCD inputs 0000-1001 (0-9) map to input + 3. Valid codes give VALID = 1; invalid input codes give 0000 and VALID = 0.": "固定 4 位字长：第 3 位为 MSB。BCD 输入 0000-1001（0-9）映射为输入 + 3。有效编码输出 VALID = 1；无效输入编码输出 0000 且 VALID = 0。",
    "Fixed 4-bit words: bit 3 is the MSB. Excess-3 inputs 0011-1100 (3-12) map to input - 3. Valid codes give VALID = 1; invalid input codes give 0000 and VALID = 0.": "固定 4 位字长：第 3 位为 MSB。余 3 码输入 0011-1100（3-12）映射为输入 - 3。有效编码输出 VALID = 1；无效输入编码输出 0000 且 VALID = 0。",
    "Gates & specifications": "门与规格",
    "Multiplexing uses the selected basic gates, not a MUX cell. SR latches require the matching NAND or NOR gate type. Edge-triggered circuits require D flip-flops; these stay selected even with Select none.": "多路选择功能使用所选基本门实现，而非 MUX 单元。SR 锁存器需要对应的 NAND 或 NOR 门类型。边沿触发电路需要 D 触发器；即使点击“全不选”，D 触发器也会保持选中。",
    "D flip-flop": "D 触发器",
    "Choose your circuit and gate library, then generate.": "请选择电路和门库，然后点击生成。",
    "Options changed. Generate to see current results.": "选项已更改。请点击生成查看当前结果。",
    "Generating… Large circuits may take longer. You can change options to cancel.": "正在生成… 大型电路可能耗时较长。修改选项即可取消。",
    "Review the error and circuit options, then generate again.": "请检查错误和电路选项，然后重新生成。",
    "Generate again or reload this page to retry.": "请重新生成或刷新页面重试。",
    "Circuit engine unavailable.": "电路引擎不可用。",
    "Minimized expressions": "化简表达式",
    "Download truth table CSV": "下载真值表 CSV",
    "Download circuit SVG": "下载电路 SVG",
    "Download circuit PNG": "下载电路 PNG",
    "White-background exports · PNG at 2× resolution": "白色背景导出 · PNG 为 2 倍分辨率",
    "Ideal illustrative waveform": "理想示意波形",
    "Ideal illustrative timing waveform": "理想示意时序波形",
    "Logical samples only: no physical propagation delays, setup/hold effects or analog behavior are simulated.": "仅为逻辑采样：不仿真物理传播延迟、建立/保持效应或模拟行为。",
    "Waveform legend": "波形图例",
    "0 / 1: known logic": "0 / 1：确定逻辑值",
    "X: unknown / invalid": "X：未知 / 无效",
    "Dashed guide: active clock edge (when present)": "虚线：有效时钟沿（如有）",
    "Download waveform SVG": "下载波形 SVG",
    "Download waveform PNG": "下载波形 PNG",
    "Hover a signal or wire to highlight its net. Only selected gate types and input counts are used.": "悬停在信号或连线上可高亮其所在网络。仅使用已选的门类型和输入数。",
    "Repeated instances of a signal label are connected feedback aliases, not additional external inputs. Q and Q′ (or Q_BAR) are distinct nets. Hover a signal or wire to highlight all matching aliases.": "重复出现的信号标签是相互连接的反馈别名，而非额外的外部输入。Q 与 Q′（或 Q_BAR）是不同的网络。悬停在信号或连线上可高亮所有对应别名。",
    "RST is asserted for the entire first cycle and clears Q only at its active edge.": "RST 在整个第一个周期内有效，且仅在其有效沿清零 Q。",
    "No reset is present; the assumed initial state is not guaranteed at power-up.": "无复位；上电时无法保证假定的初始状态。",
    "Unclocked ideal logical settling, not propagation timing. Initial state is unknown (X). Both asserted controls force the forbidden equal-output state; release into hold is indeterminate (X) until a valid set/reset resolves it.": "无时钟的理想逻辑稳定过程，并非传播时序。初始状态未知（X）。两个控制信号同时有效时强制进入两输出相等的禁止状态；释放到保持状态后输出不确定（X），直到有效的置位/复位确定状态。",
    "Circuit worker unavailable": "电路工作线程不可用",
    "Invalid circuit options": "电路选项无效",
    "Export failed": "导出失败",
    "Unable to initialize generator": "无法初始化生成器",
    "The circuit options changed.": "电路选项已更改。",
    "Circuit processing failed. Generate again to retry.": "电路处理失败。请重新生成以重试。",
    "The worker script could not be loaded or its response could not be read.": "无法加载工作线程脚本或读取其响应。",
    "The circuit worker is no longer available. Generate the circuit again before exporting.": "电路工作线程已不可用。请先重新生成电路再导出。",
    "The waveform contains no samples.": "波形不含任何采样。",
    "The image could not be rendered. Try downloading SVG.": "无法渲染图像。请尝试下载 SVG。",
    "A canvas is not available in this browser. Try downloading SVG.": "当前浏览器不支持 canvas。请尝试下载 SVG。",
    "The image is too large or could not be encoded. Try downloading SVG.": "图像过大或无法编码。请尝试下载 SVG。",
    "The circuit engine could not be loaded. Reload this page and try again.": "无法加载电路引擎。请刷新页面后重试。",
    "A value is required.": "必须填写数值。",
    "Select DFF to generate a counter or shift register.": "生成计数器或移位寄存器需选择 DFF。",

    // analog calculator
    "Basic Analog Circuit Calculator — ICDesign Lab": "基础模拟电路计算器 — ICDesign Lab",
    "Explore MOS amplifier building blocks, from common-source stages to folded cascodes. Change the circuit or its small-signal parameters to see the schematic, equations and estimates update immediately.": "探索从共源级到折叠式共源共栅的 MOS 放大器基本单元。修改电路或其小信号参数，原理图、公式和估算结果会立即更新。",
    "Calculator features": "计算器特性",
    "8 topologies": "8 种拓扑",
    "Reduced small-signal models": "简化小信号模型",
    "Choose a circuit": "选择电路",
    "No Generate step. Topology changes reset parameters; polarity and option changes keep matching values.": "无需点击生成。切换拓扑会重置参数；切换极性和选项会保留匹配的参数值。",
    "Topology": "拓扑",
    "Common-source amplifier": "共源放大器",
    "Common-gate amplifier": "共栅放大器",
    "Cascode amplifier": "共源共栅放大器",
    "Source follower": "源极跟随器",
    "Five-transistor differential amplifier": "五管差分放大器",
    "Differential common-gate amplifier": "差分共栅放大器",
    "Differential cascode amplifier": "差分共源共栅放大器",
    "Folded-cascode amplifier": "折叠式共源共栅放大器",
    "Common-source cascode amplifier": "共源共栅放大器",
    "Common-drain source follower": "共漏源极跟随器",
    "Five-transistor current-mirror differential amplifier": "五管电流镜负载差分放大器",
    "Telescopic cascode differential amplifier": "套筒式共源共栅差分放大器",
    "Folded-cascode differential amplifier": "折叠式共源共栅差分放大器",
    "Input device polarity": "输入管极性",
    "Load": "负载",
    "Resistor load": "电阻负载",
    "Active MOS load": "有源 MOS 负载",
    "Include source resistance": "包含源极电阻",
    "Inverting common-source stage with optional resistive source degeneration and explicit gate-drain feedforward capacitance.": "反相共源级，可选电阻源极退化，并显式包含栅漏前馈电容。",
    "Noninverting source-driven, AC-grounded-gate stage with optional series input resistance.": "同相、源极驱动、栅极交流接地的放大级，可选串联输入电阻。",
    "Inverting common-source/common-gate stack with one retained internal node.": "反相共源/共栅堆叠结构，保留一个内部节点。",
    "Source-loaded voltage follower with ideal DC current bias and explicit gate-source feedforward capacitance.": "源极带负载的电压跟随器，采用理想直流电流偏置，并显式包含栅源前馈电容。",
    "Matched input pair and current mirror with an ideal shared tail; positive differential-to-single-ended gain at the right output.": "匹配输入对管与电流镜，共用理想尾电流源；右侧输出端的差分转单端增益为正。",
    "Matched source-driven common-gate branches with differential input and output; optional series input resistors.": "匹配的源极驱动共栅支路，差分输入、差分输出；可选串联输入电阻。",
    "Matched differential cascode branches with opposite-polarity cascoded active loads collapsed to resistances.": "匹配的差分共源共栅支路，相反极性的共源共栅有源负载等效为电阻。",
    "Matched input pair, opposite-polarity folding devices, and cascoded output sinks collapsed to resistances.": "匹配输入对管、相反极性的折叠管，以及等效为电阻的共源共栅输出电流沉。",
    "Circuit schematic": "电路原理图",
    "Updates with configuration": "随配置实时更新",
    "Small-signal amplifier": "小信号放大器",
    "The full circuit fits the panel. Bias ports are idealized.": "完整电路自适应面板显示。偏置端口为理想化处理。",
    "Loading schematic…": "正在加载原理图…",
    "White background": "白色背景",
    "Device legend": "器件说明",
    "Small-signal parameters": "小信号参数",
    "Illustrative values, not a bias solution.": "示例数值，并非偏置求解结果。",
    "Defaults are prefilled for exploration. Replace them with values from your intended operating point.": "默认值仅供探索。请替换为目标工作点下的参数值。",
    "All fields are required. Units are shown beside each input; scientific notation such as 1e-3 is accepted.": "所有字段均为必填。单位显示在输入框旁；支持 1e-3 这类科学计数法。",
    "Reset parameters": "重置参数",
    "Restores illustrative values for the current circuit.": "恢复当前电路的示例参数值。",
    "Small-signal results": "小信号结果",
    "Analytical approximations, not transistor-level SPICE accuracy. Frequencies below are in Hz unless labeled otherwise.": "解析近似结果，不具备晶体管级 SPICE 精度。除非另有标注，以下频率单位均为 Hz。",
    "Loading the reduced model…": "正在加载简化模型…",
    "DC gain": "直流增益",
    "Signed V/V; dB uses gain magnitude.": "带符号的 V/V；dB 值按增益幅值计算。",
    "−3 dB bandwidth": "−3 dB 带宽",
    "Relative to the reduced model’s DC magnitude.": "相对于简化模型的直流幅值。",
    "Unity-gain frequency": "单位增益频率",
    "Actual |H(j2πf)| = 1 crossing of this reduced model; not the GBW estimate.": "该简化模型中 |H(j2πf)| = 1 的实际交越点，而非 GBW 估算值。",
    "Model warnings": "模型警告",
    "Key equations": "关键公式",
    "Device-parameter expressions for this reduced model. ∥ means parallel resistance; long equations can be scrolled horizontally.": "该简化模型以器件参数表示的表达式。∥ 表示电阻并联；较长的公式可横向滚动。",
    "Equation; scroll horizontally if needed": "公式；必要时可横向滚动",
    "Frequency-response details": "频率响应详情",
    "Transfer function, pole calculation and numerical coefficients. Equations remain visible when parameter inputs are incomplete.": "传递函数、极点计算和数值系数。参数输入不完整时公式仍保持显示。",
    "Assumptions & model limits": "假设与模型局限",
    "Before using these estimates": "使用这些估算值之前",
    "These are reduced, linear small-signal approximations around an assumed operating point. Only the poles, zeros and parasitics explicitly represented by the equations are included.": "这些是在假定工作点附近的简化线性小信号近似，仅包含公式中显式表示的极点、零点和寄生参数。",
    "All MOS devices are assumed to operate in saturation. Supply voltage, bias currents, headroom, output swing and saturation are not solved or verified here.": "假定所有 MOS 器件工作在饱和区。此处不求解也不验证电源电压、偏置电流、电压裕度、输出摆幅和饱和条件。",
    "Body effect is neglected in all eight models. Verify body connections and device operating points separately.": "八种模型均忽略体效应。请另行验证衬底连接和器件工作点。",
    "Bias voltages and current sources are idealized except for explicitly modeled small-signal resistance. Bias generation, mismatch, noise and large-signal behavior are outside scope.": "除显式建模的小信号电阻外，偏置电压和电流源均为理想化处理。偏置产生、失配、噪声和大信号行为不在考虑范围内。",
    "Differential models use the signal and output convention stated in their equations. Common-mode feedback (CMFB), common-mode operating point and CMFB-loop stability are not designed or checked.": "差分模型采用其公式中说明的信号与输出约定。不设计也不检查共模反馈（CMFB）、共模工作点及 CMFB 环路稳定性。",
    "Use operating-point analysis and transistor-level simulation to validate a real design. This calculator does not claim transistor-level SPICE accuracy.": "请使用工作点分析和晶体管级仿真验证实际设计。本计算器不具备晶体管级 SPICE 精度。",
    "Devices": "器件",
    "Capacitances": "电容",
    "Must be > 0.": "必须 > 0。",
    "May be 0.": "可为 0。",
    "Enter a finite value greater than 0.": "请输入大于 0 的有限数值。",
    "Enter a finite value 0 or greater.": "请输入大于或等于 0 的有限数值。",
    "Calculation unavailable for these values. Check parameter magnitudes and model limits; equations and the schematic remain available.": "这些参数值无法计算。请检查参数量级和模型局限；公式和原理图仍可查看。",
    "The circuit model could not be loaded. Choose another topology or reload the page.": "无法加载电路模型。请选择其他拓扑或重新加载页面。",
    "The analog calculation module is unavailable. Reload the page after all tool assets have loaded.": "模拟计算模块不可用。请在所有工具资源加载完成后重新加载页面。",
    "The circuit model is not loaded.": "电路模型未加载。",
    "Poles are uncancelled reduced-model characteristic roots, not full SPICE poles; coincident numerator zeros are not cancelled.": "极点为简化模型未经对消的特征根，并非完整的 SPICE 极点；与之重合的分子零点不做对消。",
    "The source follower has no independent source-resistance option; it was ignored.": "源极跟随器没有独立的源极电阻选项，已忽略。",
    "The selectable load option is unused for this topology and was ignored.": "该拓扑不使用可选负载选项，已忽略。",
    "Active-load internal capacitances are omitted; load stacks are collapsed to resistances.": "忽略有源负载内部电容；负载堆叠等效为电阻。",
    "RS = 0 shorts the source-input node to ideal drive, so CX is ignored.": "RS = 0 时源极输入节点被理想驱动短路，因此忽略 CX。",
    "The reduced model has no finite descending −3 dB crossing relative to DC; bandwidth is null.": "简化模型不存在相对直流下降 3 dB 的有限交越点；带宽为空。",
    "DC voltage gain": "直流电压增益",
    "Signed gain, including finite transistor output resistances.": "带符号增益，计入晶体管有限输出电阻。",
    "Output resistance": "输出电阻",
    "Input voltage set to zero; the load is included. ∥ denotes parallel resistance.": "输入电压置零，计入负载。∥ 表示电阻并联。",
    "Gain–bandwidth product": "增益带宽积",
    "GBW = |Av| · fp1 with the dominant pole fp1, simplified for this circuit; it estimates fu when |Av| ≫ 1 and the other poles and zeros lie above it.": "GBW = |Av| · fp1，fp1 为主极点，已针对本电路化简；当 |Av| ≫ 1 且其他极点和零点均高于它时，可用来估算 fu。",
    "Poles": "极点",
    "Zeros": "零点",
    "Exact single pole at s = −2π fp1.": "位于 s = −2π fp1 的精确单极点。",
    "Right-half-plane zero at s = +2π fz; none when CF = 0.": "位于 s = +2π fz 的右半平面零点；CF = 0 时不存在。",
    "Left-half-plane zero at s = −2π fz; none when CGS = 0.": "位于 s = −2π fz 的左半平面零点；CGS = 0 时不存在。",
    "Left-half-plane zero at s = −2π fz; none when CX = 0.": "位于 s = −2π fz 的左半平面零点；CX = 0 时不存在。",
    "Output-pole frequency; the right-half-plane zero is neglected. The value shown is the exact crossing of the reduced model.": "输出极点频率，忽略右半平面零点。显示值为简化模型的精确交越点。",
    "Output-pole frequency; the left-half-plane zero is neglected. The value shown is the exact crossing of the reduced model.": "输出极点频率，忽略左半平面零点。显示值为简化模型的精确交越点。",
    "Single-pole estimate |Av| · f−3dB, valid when |Av| ≫ 1 and the remaining poles and zeros lie above fu. The value shown is the exact crossing of the reduced model.": "单极点估算 |Av| · f−3dB，在 |Av| ≫ 1 且其余极点和零点均高于 fu 时成立。显示值为简化模型的精确交越点。",
    "Dominant-pole estimate, valid when the non-dominant pole and the zero lie well above it. The value shown is the exact crossing of the reduced model.": "主极点估算，在非主极点和零点远高于它时成立。显示值为简化模型的精确交越点。",
    "Widely spaced pole estimates (fp1 ≪ fp2) from the denominator D(s) in the details below; fp2 applies for CX > 0. Values shown are the exact roots; complex pairs are reported as |s|/2π.": "根据下方详情中分母 D(s) 得到的极点分离估算（fp1 ≪ fp2）；fp2 适用于 CX > 0。显示值为精确根；共轭复根按 |s|/2π 给出。",
    "Transfer function": "传递函数",
    "Exact within the stated reduced model. Numeric coefficients are rounded to four significant digits; s is in rad/s.": "在所述简化模型内精确成立。数值系数保留四位有效数字；s 的单位为 rad/s。",
    "Gain in decibels": "增益（分贝）",
    "Denominator": "分母",
    "Only two frequency coefficients are needed; they are not extra circuit parameters.": "只需两个频率系数，它们不是额外的电路参数。",
    "First-order coefficient": "一阶系数",
    "Second-order coefficient": "二阶系数",
    "Valid also at RS = 0: a2 = 0 and CX drops out.": "RS = 0 时同样成立：a2 = 0，CX 不再起作用。",
    "Pole locations": "极点位置",
    "For a2 > 0; if a2 = 0, the single pole is p1 = −1/a1.": "适用于 a2 > 0；若 a2 = 0，则单极点为 p1 = −1/a1。",
    "No finite zero": "无有限零点",
    "No finite zero in this model": "该模型无有限零点",
    "No feedforward zero in this reduced model.": "该简化模型无前馈零点。",
    "Exact for this single-pole model.": "对该单极点模型精确成立。",
    "Exact for this single-pole model; a crossing exists only when |Av| > 1.": "对该单极点模型精确成立；仅当 |Av| > 1 时存在交越点。",
    "No crossing in this model": "该模型无交越点",
    "No unity-gain crossing": "无单位增益交越点",
    "Both the DC gain and the high-frequency gain CGS/(CL + CGS) are below 1, so |H| never reaches 1.": "直流增益和高频增益 CGS/(CL + CGS) 均小于 1，因此 |H| 始终达不到 1。",
    "Reduced-order small-signal model, not a full transistor or SPICE pole model.": "降阶小信号模型，并非完整的晶体管或 SPICE 极点模型。",
    "Ideal small-signal input voltage drive; all devices are assumed biased in saturation. Transconductances are positive magnitudes, body effect is neglected, and supply and bias voltages are AC-grounded.": "理想小信号输入电压驱动；假定所有器件偏置在饱和区。跨导取正的幅值，忽略体效应，电源和偏置电压均交流接地。",
    "CL includes only the specified lumped output-to-AC-ground loading; CX, when present, includes only the specified internal-node-to-AC-ground loading. Neither includes the other node or explicit feedforward capacitances. Individual transistor Cgs, Cgd and Cdb are not inferred or separately modeled, except the explicit CS CF and follower CGS.": "CL 仅包含指定的输出端对交流地集总负载；若存在 CX，CX 仅包含指定的内部节点对交流地负载。两者均不包含另一节点电容或显式前馈电容。除显式的共源级 CF 和跟随器 CGS 外，不推导或单独建模各晶体管的 Cgs、Cgd 和 Cdb。",
    "Changing NMOS to PMOS complements device polarities without changing gain signs for the same small-signal magnitudes and voltage conventions.": "将 NMOS 改为 PMOS 会互换器件极性；在相同小信号幅值和电压约定下，增益符号不变。",
    "GBW is |gain| times the dominant pole frequency fp1 = 1/(2π a1), not generally the actual model unity crossing. Returned pole and zero coordinates are in s-plane rad/s, not Hz.": "GBW 为 |增益| 乘以主极点频率 fp1 = 1/(2π a1)，一般不等于模型的实际单位增益交越点。返回的极点和零点坐标位于 s 平面，单位为 rad/s 而非 Hz。",
    "Load resistance RL.": "负载电阻 RL。",
    "Output capacitance excluding CF.": "输出电容（不含 CF）。",
    "Input device; gm1 and ro1.": "输入管；gm1 与 ro1。",
    "Direct gate-drain feedforward capacitance; zero omits this branch.": "栅漏直接前馈电容；为零时忽略该支路。",
    "Transconductance of M1": "M1 跨导",
    "Output resistance of M1": "M1 输出电阻",
    "Output load resistance": "输出负载电阻",
    "Lumped output-to-AC-ground capacitance": "输出端对交流地的集总电容",
    "Direct M1 gate-drain feedforward capacitance, excluded from CL": "M1 栅漏直接前馈电容（不计入 CL）",
    "Source degeneration resistance RS.": "源极退化电阻 RS。",
    "Source resistance": "源极电阻",
    "Resistive source degeneration, per input device": "电阻源极退化（每个输入管）",
    "RS is resistive source degeneration. Its effect on input transconductance and output resistance includes finite ro1; matched shared-tail symmetry is retained. Resistor parasitic capacitances are omitted.": "RS 为电阻源极退化。其对输入跨导和输出电阻的影响计入了有限的 ro1；保留匹配共尾结构的对称性。忽略电阻寄生电容。",
    "AC-grounded current-source load; output resistance roL.": "交流接地的电流源负载；输出电阻为 roL。",
    "Collapsed active-load output resistance": "有源负载等效输出电阻",
    "The active load is a resistance roL to AC ground; its internal dynamics are omitted.": "有源负载等效为对交流地的电阻 roL，忽略其内部动态特性。",
    "Output lumped capacitance.": "输出集总电容。",
    "Ideal source-node DC bias current; AC open circuit.": "源极节点理想直流偏置电流；交流开路。",
    "Input series source resistance, not a shunt degeneration resistor.": "输入串联源电阻，而非并联退化电阻。",
    "Lumped source-node capacitance; shorted by ideal drive when RS = 0.": "源极节点集总电容；RS = 0 时被理想驱动短路。",
    "Series source-input resistance, per branch": "源极输入串联电阻（每条支路）",
    "Lumped capacitance to AC ground at source-input node after RS (shorted by ideal drive when RS = 0)": "RS 之后源极输入节点对交流地的集总电容（RS = 0 时被理想驱动短路）",
    "RS is series input resistance at each driven source, not source degeneration to ground. CX is ineffective when RS = 0 because the source is ideally voltage-driven; resistor parasitic capacitances are omitted.": "RS 为每个被驱动源极处的串联输入电阻，而非对地的源极退化电阻。RS = 0 时源极由理想电压驱动，CX 不起作用；忽略电阻寄生电容。",
    "Common-gate cascode; gm2, ro2.": "共栅 cascode 管；gm2、ro2。",
    "Cascode source / input drain lumped capacitance.": "cascode 管源极 / 输入管漏极集总电容。",
    "Input common-source device; gm1, ro1.": "共源输入管；gm1、ro1。",
    "Transconductance of M2 signal common-gate cascode": "M2 信号通路共栅 cascode 管跨导",
    "Output resistance of M2 signal common-gate cascode": "M2 信号通路共栅 cascode 管输出电阻",
    "Lumped capacitance to AC ground at input-drain / signal-cascode-source node": "输入管漏极 / 信号 cascode 管源极节点对交流地的集总电容",
    "Signal-path output branch": "信号通路输出支路",
    "Output resistance looking into the signal cascode, before paralleling the load.": "从信号 cascode 管看进去的输出电阻（未并联负载）。",
    "Degenerated input branch": "带源极退化的输入支路",
    "Resistance looking into an input drain with its gate at AC ground; not an extra component.": "栅极交流接地时从输入管漏极看进去的电阻；并非额外元件。",
    "Input follower; gm1, ro1. Body effect neglected.": "输入跟随管；gm1、ro1。忽略体效应。",
    "Gate-source feedforward capacitance; zero omits this branch.": "栅源前馈电容；为零时忽略该支路。",
    "Ideal DC bias current; infinite small-signal resistance.": "理想直流偏置电流；小信号电阻无穷大。",
    "Source load resistance RL.": "源极负载电阻 RL。",
    "Output capacitance excluding CGS.": "输出电容（不含 CGS）。",
    "Source load resistance; DC current bias IB is ideal": "源极负载电阻；直流偏置电流 IB 为理想值",
    "Direct M1 gate-source feedforward capacitance, excluded from CL": "M1 栅源直接前馈电容（不计入 CL）",
    "RL is the source load; IB is an ideal DC bias current source with infinite small-signal resistance. The bulk is tied to the source for this model. No independent RS option or roL is used.": "RL 为源极负载；IB 为小信号电阻无穷大的理想直流偏置电流源。本模型中衬底与源极相连。不使用独立的 RS 选项或 roL。",
    "Diode-connected reference mirror; gm3, ro3 matched to M4.": "二极管连接的电流镜参考管；gm3、ro3 与 M4 匹配。",
    "Output mirror; gm3, ro3 matched to M3.": "电流镜输出管；gm3、ro3 与 M3 匹配。",
    "Mirror/reference-node lumped capacitance.": "电流镜参考节点集总电容。",
    "Single-ended output lumped capacitance.": "单端输出集总电容。",
    "Positive input; matched gm1, ro1 pair.": "正输入端；gm1、ro1 匹配的对管。",
    "Negative input; matched gm1, ro1 pair.": "负输入端；gm1、ro1 匹配的对管。",
    "Tail bias transistor idealized as an AC current source (ro → ∞).": "尾电流偏置管理想化为交流电流源（ro → ∞）。",
    "Transconductance of matched M1/M2 input pair, per device": "匹配输入对管 M1/M2 的跨导（每管）",
    "Output resistance of matched M1/M2 input pair, per device": "匹配输入对管 M1/M2 的输出电阻（每管）",
    "Transconductance of matched M3/M4 current mirror, per device": "匹配电流镜 M3/M4 的跨导（每管）",
    "Output resistance of matched M3/M4 current mirror, per device": "匹配电流镜 M3/M4 的输出电阻（每管）",
    "Lumped capacitance to AC ground at M3 diode-connected mirror/reference node": "M3 二极管连接电流镜参考节点对交流地的集总电容",
    "Positive differential-to-single-ended gain at the right output; finite mirror resistance is retained.": "右侧输出端的差分转单端增益为正；保留电流镜的有限电阻。",
    "Matched differential pairs and equal per-branch values are assumed. vi = vi+ − vi− with the left input positive; common mode is fixed, the tail is ideal in AC, and there is no CMFB or stability prediction.": "假定差分对管匹配且各支路参数相等。vi = vi+ − vi−，左侧输入为正；共模电平固定，尾电流源在交流下为理想，无 CMFB，也不预测稳定性。",
    "vo is the single right output, giving positive differential gain. M3/M4 form the opposite-polarity mirror and M5 is the ideal tail. The shared tail source is eliminated exactly, not blindly AC-grounded; CL is at the output and CX is at the mirror/reference node, not the tail.": "vo 为右侧单端输出，差分增益为正。M3/M4 构成相反极性的电流镜，M5 为理想尾电流源。共用尾节点被精确消去，而非简单交流接地；CL 位于输出端，CX 位于电流镜参考节点而非尾节点。",
    "Load resistance RL per branch.": "每条支路的负载电阻 RL。",
    "CL per output, not a capacitor between outputs.": "每个输出端的 CL，而非跨接在两输出之间的电容。",
    "Common-gate input; gm1, ro1 matched in both branches.": "共栅输入管；两条支路的 gm1、ro1 匹配。",
    "Ideal DC bias; no small-signal admittance.": "理想直流偏置；无小信号导纳。",
    "Lumped output-to-AC-ground capacitance, per output branch": "输出端对交流地的集总电容（每条输出支路）",
    "vo = left vo+ − right vo−. CL and CX are per branch, not a capacitance bridging the two branches; differential gain has no extra factor of two.": "vo = 左侧 vo+ − 右侧 vo−。CL 和 CX 按支路计，而非跨接两支路的电容；差分增益不含额外的 2 倍因子。",
    "Lumped capacitance per source node.": "每个源极节点的集总电容。",
    "Series input source resistance RS per branch.": "每条支路的串联输入源电阻 RS。",
    "Lumped capacitance to AC ground at source-input node after RS (shorted by ideal drive when RS = 0), per branch": "RS 之后源极输入节点对交流地的集总电容（RS = 0 时被理想驱动短路，每条支路）",
    "Outer load bias device; ro7 per device.": "外侧负载偏置管；每管 ro7。",
    "Load cascode; gm5, ro5. Its internal capacitance is omitted.": "负载 cascode 管；gm5、ro5。忽略其内部电容。",
    "Signal-path cascode; gm3, ro3.": "信号通路 cascode 管；gm3、ro3。",
    "Input pair; matched gm1, ro1.": "输入对管；gm1、ro1 匹配。",
    "CL per output to AC ground.": "每个输出端对交流地的 CL。",
    "Signal cascode source-node capacitance per half circuit.": "每个半电路中信号 cascode 管源极节点电容。",
    "Tail bias; ideal AC source in matched differential mode. CMFB is not modeled.": "尾电流偏置；在匹配差分模式下为理想交流源。未建模 CMFB。",
    "Transconductance of matched M3/M4 signal cascodes, per device": "匹配信号 cascode 管 M3/M4 的跨导（每管）",
    "Output resistance of matched M3/M4 signal cascodes, per device": "匹配信号 cascode 管 M3/M4 的输出电阻（每管）",
    "Transconductance of matched M5/M6 load cascodes, per device": "匹配负载 cascode 管 M5/M6 的跨导（每管）",
    "Output resistance of matched M5/M6 load cascodes, per device": "匹配负载 cascode 管 M5/M6 的输出电阻（每管）",
    "Output resistance of matched M7/M8 outer load bias devices, per device": "匹配外侧负载偏置管 M7/M8 的输出电阻（每管）",
    "Lumped capacitance to AC ground at input-drain / signal-cascode-source node, per branch": "输入管漏极 / 信号 cascode 管源极节点对交流地的集总电容（每条支路）",
    "Load-stack output branch": "负载堆叠输出支路",
    "Equivalent resistance of the output load stack; its internal capacitances are omitted.": "输出负载堆叠的等效电阻；忽略其内部电容。",
    "M5/M6 are opposite-polarity load cascodes over M7/M8 outer bias devices (PMOS for NMOS inputs); M9 is the ideal tail. Load-stack internal capacitances are omitted and the load is collapsed to Rload = ro5 + ro7 + gm5 ro5 ro7.": "M5/M6 为相反极性的负载 cascode 管，位于外侧偏置管 M7/M8 之上（NMOS 输入时为 PMOS）；M9 为理想尾电流源。忽略负载堆叠内部电容，负载等效为 Rload = ro5 + ro7 + gm5 ro5 ro7。",
    "Folding-node bias current source; ro3 per device.": "折叠节点偏置电流源；每管 ro3。",
    "Opposite-polarity folding common-gate device; gm5, ro5.": "相反极性的折叠共栅管；gm5、ro5。",
    "Output sink cascode; gm7, ro7. Internal load capacitance omitted.": "输出电流沉 cascode 管；gm7、ro7。忽略负载内部电容。",
    "Output sink bias device; ro9 per device.": "输出电流沉偏置管；每管 ro9。",
    "CL per output; folded branches are independent in differential mode.": "每个输出端的 CL；差分模式下各折叠支路相互独立。",
    "Differential input; gm1, ro1 matched.": "差分输入；gm1、ro1 匹配。",
    "Input drain / folding source lumped capacitance per half circuit.": "每个半电路中输入管漏极 / 折叠管源极的集总电容。",
    "Input tail bias, idealized in differential mode. CMFB and bias generators are external.": "输入尾电流偏置，在差分模式下理想化。CMFB 和偏置产生电路位于外部。",
    "Transconductance of matched M5/M6 folding common-gate devices, per device": "匹配折叠共栅管 M5/M6 的跨导（每管）",
    "Output resistance of matched M5/M6 folding common-gate devices, per device": "匹配折叠共栅管 M5/M6 的输出电阻（每管）",
    "Output resistance of matched M3/M4 folding-node bias devices, per device": "匹配折叠节点偏置管 M3/M4 的输出电阻（每管）",
    "Transconductance of matched M7/M8 output sink cascodes, per device": "匹配输出电流沉 cascode 管 M7/M8 的跨导（每管）",
    "Output resistance of matched M7/M8 output sink cascodes, per device": "匹配输出电流沉 cascode 管 M7/M8 的输出电阻（每管）",
    "Output resistance of matched M9/M10 output sink bias devices, per device": "匹配输出电流沉偏置管 M9/M10 的输出电阻（每管）",
    "Lumped capacitance to AC ground at folding node (input drain / M5 or M6 source), per branch": "折叠节点（输入管漏极 / M5 或 M6 源极）对交流地的集总电容（每条支路）",
    "M5/M6 are opposite-polarity folding devices; M3/M4 supply folding-node bias. M7/M8 output sink cascodes sit over M9/M10 bias devices; M11 is the ideal tail. Output-load internal capacitances are omitted and the load is collapsed to Rload = ro7 + ro9 + gm7 ro7 ro9.": "M5/M6 为相反极性的折叠管；M3/M4 提供折叠节点偏置。输出电流沉 cascode 管 M7/M8 位于偏置管 M9/M10 之上；M11 为理想尾电流源。忽略输出负载内部电容，负载等效为 Rload = ro7 + ro9 + gm7 ro7 ro9。"
  };

  // paragraphs whose sentence is split by inline markup; keyed by whitespace-normalized innerHTML
  const H = {
    "Names must be unique, start with a letter or underscore, and contain only letters, digits and underscores. First input is the most significant bit. Up to <strong>8 inputs</strong> and <strong>8 outputs</strong>.":
      "名称必须唯一，以字母或下划线开头，且只能包含字母、数字和下划线。第一个输入为最高有效位。最多 <strong>8 个输入</strong>和 <strong>8 个输出</strong>。",
    "Choose gate types and allowed input counts: <strong>2, 3 and/or 4 inputs</strong> for each type, all selected by default. INV always has 1 input. Click a gate name to toggle all its input counts.":
      "选择门类型及允许的输入数：每种类型可选 <strong>2、3 和/或 4 输入</strong>，默认全部选中。INV 始终为 1 输入。点击门名称可切换其全部输入数。",
    "Rows are generated automatically from all-0s to all-1s. Every output cell starts at <code>0</code> — click it to toggle between <code>0</code> and <code>1</code>.":
      "行从全 0 到全 1 自动生成。每个输出单元格初始为 <code>0</code>，点击可在 <code>0</code> 与 <code>1</code> 之间切换。",
    "Supported: <code>*</code> or adjacent parentheses for AND, <code>+</code> for OR, postfix <code>'</code> for NOT, <code>⊕</code> (<code>^</code>) for XOR, and <code>⊙</code> (<code>~^</code>) for XNOR. Precedence: NOT &gt; AND &gt; XOR/XNOR &gt; OR. Constants <code>0</code> and <code>1</code> are supported. Signal names are case-sensitive. Hover over a parenthesis to highlight its matching pair.":
      "支持：<code>*</code> 或相邻括号表示 AND，<code>+</code> 表示 OR，后缀 <code>'</code> 表示 NOT，<code>⊕</code>（<code>^</code>）表示 XOR，<code>⊙</code>（<code>~^</code>）表示 XNOR。优先级：NOT &gt; AND &gt; XOR/XNOR &gt; OR。支持常量 <code>0</code> 和 <code>1</code>。信号名区分大小写。将鼠标悬停在括号上可高亮与之配对的括号。",
    "Choose gate types and allowed input counts: <strong>2, 3 and/or 4 inputs</strong>, all selected by default. Click a gate name to toggle its specs. INV always has 1 input; multi-input XNOR inverts XOR parity.":
      "选择门类型及允许的输入数：<strong>2、3 和/或 4 输入</strong>，默认全部选中。点击门名称可切换其规格。INV 始终为 1 输入；多输入 XNOR 为 XOR 奇偶校验的反相。"
  };

  const edge = e => e === 'rising' ? '上升沿' : '下降沿';
  const P = [
    // analog
    [/^(NMOS|PMOS) (.+) — reduced-order model$/, m => m[1] + ' ' + t(m[2]) + ' — 降阶模型'],
    [/^Complete or correct: (.+)\. All numeric results are cleared; equations and the schematic remain available\.$/,
      m => '请补全或修正：' + m[1] + '。所有数值结果已清空；公式和原理图仍可查看。'],
    [/^Updated automatically from the current small-signal values\. These estimates do not verify bias or saturation\.( Review the model warnings below\.)?( The schematic renderer is unavailable; calculations are still shown\.)?$/,
      m => '已根据当前小信号参数自动更新。这些估算不验证偏置或饱和条件。' + (m[1] ? '请查看下方的模型警告。' : '') + (m[2] ? '原理图渲染器不可用；计算结果仍会显示。' : '')],
    [/^(SVG|PNG) download requested\. The export uses a white background\.$/, m => '已请求下载 ' + m[1] + '。导出图像使用白色背景。'],
    [/^(SVG|PNG) download could not be prepared\. Please try again( or download SVG)?\.$/,
      m => '无法准备 ' + m[1] + ' 下载。请重试' + (m[2] ? '或改为下载 SVG' : '') + '。'],
    // combinational
    [/^(\d+) rows \(2\^(\d+) input combinations\)\. Click a cell to toggle between 0 and 1\.$/,
      m => '共 ' + m[1] + ' 行（2^' + m[2] + ' 种输入组合）。点击单元格可在 0 和 1 之间切换。'],
    [/^gates: (\d+)$/, m => '门数：' + m[1]],
    [/^wires: (\d+)$/, m => '连线数：' + m[1]],
    [/^levels: (\d+)$/, m => '级数：' + m[1]],
    [/^Insert signal (.+)$/, m => '插入信号 ' + m[1]],
    [/^(\w+) input counts$/, m => m[1] + ' 输入数'],
    [/^(\w+): (\d) inputs?$/, m => m[1] + '：' + m[2] + ' 输入'],
    [/^Error: (.+)$/, m => '错误：' + t(m[1])],
    [/^Cannot generate output "(.+)"$/, m => '无法生成输出“' + m[1] + '”'],
    [/^Invalid expression for "(.+)"$/, m => '输出“' + m[1] + '”的表达式无效'],
    [/^Unknown input signal "(.+)"$/, m => '未知输入信号“' + m[1] + '”'],
    [/^Unsupported symbol "(.+)"$/, m => '不支持的符号“' + m[1] + '”'],
    [/^(.+) at character (\d+)\.$/, m => { const r = tr(m[1]); return r == null ? null : r + '（第 ' + m[2] + ' 个字符）。'; }],
    [/^Signal name at position (\d+) is empty\. Please name every signal\.$/, m => '第 ' + m[1] + ' 个信号名称为空。请为每个信号命名。'],
    [/^Invalid signal name "(.*)"\. Use letters, digits, underscore; start with a letter or underscore\.$/,
      m => '信号名称“' + m[1] + '”无效。只能使用字母、数字和下划线，并以字母或下划线开头。'],
    [/^Duplicate signal name "(.*)"\. Signal names must be unique\.$/, m => '信号名称“' + m[1] + '”重复。信号名称必须唯一。'],
    [/^Too many (inputs|outputs) \(max (\d+)\)\.$/, m => (m[1] === 'inputs' ? '输入' : '输出') + '过多（最多 ' + m[2] + ' 个）。'],
    [/^Select at least one input count for (\w+)\.$/, m => '请至少为 ' + m[1] + ' 选择一种输入数。'],
    [/^No selected (\w+) input count can fit this gate\.$/, m => '所选的 ' + m[1] + ' 输入数均无法用于该门。'],
    [/^No selected gate can implement (\w+)\.$/, m => '所选门均无法实现 ' + m[1] + '。'],
    // typical
    [/^(NOR|NAND) SR latch$/, m => m[1] + ' 型 SR 锁存器'],
    [/^(\d+)-to-(\d+) decoder$/, m => m[1] + '-' + m[2] + ' 译码器'],
    [/^(\d+)-to-(\d+) thermometer decoder$/, m => m[1] + '-' + m[2] + ' 温度计码译码器'],
    [/^(\d+)-input priority encoder$/, m => m[1] + ' 输入优先编码器'],
    [/^(\d+):1 multiplexer$/, m => m[1] + ' 选 1 多路选择器'],
    [/^1-to-(\d+) demultiplexer$/, m => '1 至 ' + m[1] + ' 数据分配器'],
    [/^(\d+)-bit modulo-(\d+) (up|down) counter$/, m => m[1] + ' 位模 ' + m[2] + (m[3] === 'up' ? ' 加' : ' 减') + '法计数器'],
    [/^(\d+)-bit (left|right) shift register$/, m => m[1] + ' 位' + (m[2] === 'left' ? '左' : '右') + '移寄存器'],
    [/^Two actual cross-coupled (NOR|NAND) gates; no clock and no DFF\. Q and Q_BAR input aliases denote feedback, not external inputs\.$/,
      m => '由两个真实交叉耦合的 ' + m[1] + ' 门构成；无时钟、无 DFF。Q 和 Q_BAR 输入别名表示反馈，而非外部输入。'],
    [/^Thermometer code has 2\^N - 1 output bits: Yk is active when A > k, so A = 0 activates none and A = k activates the lowest k bits, starting at Y0\. Active outputs are ([01]); all others are ([01])\.$/,
      m => '温度计码共有 2^N - 1 个输出位：A > k 时 Yk 有效，因此 A = 0 时无输出有效，A = k 时从 Y0 开始的最低 k 位有效。有效输出为 ' + m[1] + '，其余均为 ' + m[2] + '。'],
    [/^Active-high inputs: the (highest|lowest) asserted index wins\. Y encodes that index; VALID = 1\. With no asserted input, Y = 0 and VALID = 0\.$/,
      m => '输入高电平有效：有效输入中索引' + (m[1] === 'highest' ? '最高' : '最低') + '者优先。Y 输出该索引的编码，VALID = 1。无有效输入时，Y = 0 且 VALID = 0。'],
    [/^All DFFs update simultaneously on the (rising|falling) CLK edge\. Counting wraps modulo (\d+); unused states Q >= modulus recover to 0 on the next active edge\.$/,
      m => '所有 DFF 在 CLK ' + edge(m[1]) + '同时更新。计数按模 ' + m[2] + ' 循环；Q ≥ 模值的未用状态会在下一个有效沿恢复为 0。'],
    [/^On each (rising|falling) CLK edge, bits shift (left|right); SI enters Q(\d+)\. SO is the current outgoing Q(\d+), the bit discarded at the next shift edge\. After an edge SO follows the new end bit\.$/,
      m => '在每个 CLK ' + edge(m[1]) + '，各位' + (m[2] === 'left' ? '左' : '右') + '移；SI 移入 Q' + m[3] + '。SO 为当前移出的 Q' + m[4] + '，即下一个移位沿将丢弃的位。有效沿之后 SO 跟随新的末端位。'],
    [/^Initial state (\d+) is a waveform-only assumption, not a power-up preset\.$/, m => '初始状态 ' + m[1] + ' 仅为波形假设，并非上电预置值。'],
    [/^Ideal logical samples \(4 per cycle\), no physical propagation delay\. CLK starts low; rising edges are phase 1, falling edges phase 3\. Controls change at phase 0\. Initial Q = (\d+) is a waveform-only assumption, not hardware initialization\. (.+)$/,
      m => '理想逻辑采样（每周期 4 个），无物理传播延迟。CLK 初始为低电平；上升沿位于相位 1，下降沿位于相位 3。控制信号在相位 0 变化。初始 Q = ' + m[1] + ' 仅为波形假设，并非硬件初始化。' + t(m[2])],
    [/^The (NOR|NAND) SR latch requires selected \1 gates; choose that gate type or change latch topology\.$/,
      m => m[1] + ' 型 SR 锁存器需要选择 ' + m[1] + ' 门；请选择该门类型或更改锁存器结构。'],
    [/^Generated net requires unselected gate (\w+)\.$/, m => '生成的网表需要未选择的门 ' + m[1] + '。'],
    [/^Generated (\w+) does not match selected input counts\.$/, m => '生成的 ' + m[1] + ' 与所选输入数不匹配。'],
    [/^Generated (.+)\.$/, m => '已生成' + t(m[1]) + '。'],
    [/^(.+) must be an integer from (\d+) to (\d+)\.$/, m => t(m[1]) + '必须为 ' + m[2] + ' 到 ' + m[3] + ' 之间的整数。'],
    [/^Circuit processing failed\. Generate again or reload this page, and check that your browser allows Web Workers and typical-worker\.js\.(?: (.+))?$/,
      m => '电路处理失败。请重新生成或刷新页面，并确认浏览器允许 Web Worker 和 typical-worker.js。' + (m[1] ? t(m[1]) : '')],
    // "<label>: <message>" for option errors and synthesis reasons
    [/^([^:]+): (.+)$/, m => { const a = tr(m[1]); return a == null ? null : a + '：' + t(m[2]); }]
  ];

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const cache = new Map();
  function tr(s) {
    if (cache.has(s)) return cache.get(s);
    let r = own(D, s) ? D[s] : null;
    for (let i = 0; r == null && i < P.length; i++) {
      const m = s.match(P[i][0]);
      if (m) r = P[i][1](m);
    }
    cache.set(s, r);
    return r;
  }
  function t(s) { const r = tr(s); return r == null ? s : r; }
  const norm = s => s.replace(/\s+/g, ' ').trim();

  let lang = 'en';
  let records = [];

  function translateText(node) {
    const raw = node.nodeValue;
    if (!raw || !/[A-Za-z]/.test(raw)) return;
    const key = norm(raw);
    const zh = tr(key);
    if (zh == null || zh === key) return;
    const value = (/^\s/.test(raw) && !CJK_START.test(zh) ? ' ' : '') + zh + (/\s$/.test(raw) && !CJK_END.test(zh) ? ' ' : '');
    records.push({ node, en: raw, zh: value });
    node.nodeValue = value;
  }
  function translateAttr(el, name) {
    const raw = el.getAttribute(name);
    if (!raw || !/[A-Za-z]/.test(raw)) return;
    const zh = tr(norm(raw));
    if (zh == null || zh === raw) return;
    records.push({ el, attr: name, en: raw, zh });
    el.setAttribute(name, zh);
  }
  function translateBlock(el) {
    const en = el.innerHTML;
    const key = norm(en);
    if (!own(H, key)) return false;
    el.innerHTML = H[key];
    records.push({ el, html: true, en, zh: el.innerHTML });
    return true;
  }
  function visit(node, noText) {
    if (node.nodeType === 3) { if (!noText) translateText(node); return; }
    if (node.nodeType !== 1 || node.matches(SKIP_ALL)) return;
    if (!noText && node.matches(NO_TEXT)) noText = true;
    for (const name of ATTRS) if (node.hasAttribute(name)) translateAttr(node, name);
    if (!noText && node.tagName === 'P' && node.firstElementChild && translateBlock(node)) return;
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, noText);
  }
  function visitFrom(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !node.isConnected || el.closest(SKIP_ALL)) return;
    visit(node, !!(el.parentElement && el.parentElement.closest(NO_TEXT)));
  }

  function restore() {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.node) { if (r.node.nodeValue === r.zh) r.node.nodeValue = r.en; }
      else if (r.html) { if (r.el.innerHTML === r.zh) r.el.innerHTML = r.en; }
      else if (r.el.getAttribute(r.attr) === r.zh) r.el.setAttribute(r.attr, r.en);
    }
    records = [];
  }

  const observer = new MutationObserver(list => {
    if (lang !== 'zh') return;
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(visitFrom);
      else if (m.type === 'characterData') visitFrom(m.target);
      else if (m.target.isConnected && !m.target.closest(SKIP_ALL)) translateAttr(m.target, m.attributeName);
    }
    observer.takeRecords();
    if (records.length > 5000) records = records.filter(r => (r.node || r.el).isConnected);
  });

  function updateButton() {
    const button = document.getElementById('lang-toggle');
    if (!button) return;
    const zh = lang === 'zh';
    button.textContent = zh ? 'EN' : '中文';
    button.lang = zh ? 'en' : 'zh-CN';
    button.title = zh ? 'Switch to English' : '切换到中文';
    button.setAttribute('aria-label', button.title);
  }

  function apply(next) {
    if (next === lang) { updateButton(); return; }
    lang = next;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    if (lang === 'zh') {
      visit(document.documentElement, false);
      observer.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS
      });
    } else {
      observer.disconnect();
      restore();
    }
    updateButton();
  }

  function stored() {
    try { return localStorage.getItem(STORAGE_KEY) === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; }
  }

  apply(stored());
  document.addEventListener('DOMContentLoaded', () => {
    if (lang === 'zh') visit(document.documentElement, false);
    updateButton();
    const button = document.getElementById('lang-toggle');
    if (button) button.addEventListener('click', () => {
      const next = lang === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* private mode: switch for this page only */ }
      apply(next);
    });
  });
  // keep prerendered, restored-from-cache and other open pages in sync with the stored choice
  document.addEventListener('prerenderingchange', () => apply(stored()));
  window.addEventListener('pageshow', event => { if (event.persisted) apply(stored()); });
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) apply(stored()); });
})();
