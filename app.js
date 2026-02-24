const { createApp, ref, reactive, computed, onMounted, onUnmounted } = Vue;
const { createRouter, createWebHashHistory, useRouter } = VueRouter;
const { ElMessage, ElMessageBox } = ElementPlus;

/* ==================== API 请求封装 ====================
   所有请求都经过这个函数，自动带上 JWT Token
   ================================================== */
const API_BASE = 'https://task-manage-production.up.railway.app';

async function request(method, path, body = null) {
  const token = localStorage.getItem('tf_token');
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // Token 过期或未登录 → 跳转登录页
  if (res.status === 401) {
    localStorage.removeItem('tf_token');
    localStorage.removeItem('tf_user');
    window.location.hash = '/login';
    throw new Error('登录已过期，请重新登录');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

/* ==================== 数据格式转换 ====================
   后端用 category_id(数字) + due_date
   前端用 category(字符串) + due
   ================================================== */
function normalizeTask(t) {
  return {
    id:        String(t.id),
    title:     t.title,
    desc:      t.desc || '',
    category:  t.category_id ? String(t.category_id) : '',
    priority:  t.priority  || 'medium',
    status:    t.status    || 'pending',
    due:       t.due_date  || '',
    createdAt: new Date(t.created_at).getTime(),
  };
}

function normalizeCat(c) {
  return { id: String(c.id), name: c.name, color: c.color };
}

function taskToPayload(form) {
  return {
    title:       form.title.trim(),
    desc:        form.desc || '',
    category_id: form.category ? parseInt(form.category) : null,
    priority:    form.priority,
    status:      form.status,
    due_date:    form.due || null,
  };
}

/* ==================== 常量 ==================== */
const COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444',
  '#f59e0b','#22c55e','#14b8a6','#3b82f6','#f97316','#64748b',
];
const PRIORITY_TYPE  = { high: 'danger', medium: 'warning', low: 'success' };
const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };

/* ==================== 工具函数 ==================== */
function today()    { return new Date().toISOString().slice(0, 10); }
function isOverdue(s) { return !!(s && s < today()); }
function isToday(s)   { return s === today(); }
function isSoon(s) {
  if (!s) return false;
  const d = (new Date(s + 'T00:00:00') - new Date()) / 86400000;
  return d >= 0 && d <= 2;
}
function fmtDate(s) {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/* ==================== 登录页 ==================== */
const LoginPage = {
  template: `
    <div class="login-bg">
      <div class="login-wrap" style="animation: fadeUp .45s ease;">
        <el-card class="login-card" shadow="always">
          <div class="login-logo">
            <div class="logo-mark">
              <el-icon :size="22" color="#fff"><Check /></el-icon>
            </div>
            <span class="logo-text">TaskFlow</span>
          </div>
          <p class="login-sub">高效管理你的每一项任务</p>

          <!-- 后端连接状态 -->
          <div class="api-status" :class="apiStatus">
            <span class="api-dot"></span>
            <span class="api-text">{{ apiStatusText }}</span>
          </div>

          <el-form :model="form" :rules="rules" ref="formRef" label-position="top" size="large" @submit.prevent="submit">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="form.username" placeholder="请输入用户名" :prefix-icon="icons.User" clearable />
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input v-model="form.password" type="password" placeholder="请输入密码" :prefix-icon="icons.Lock" show-password @keyup.enter="submit" />
            </el-form-item>
            <el-form-item style="margin-top:4px;">
              <el-button class="login-submit-btn" type="primary" size="large" :loading="loading" @click="submit">登 录</el-button>
            </el-form-item>
          </el-form>

          <el-divider><el-text type="info" size="small">没有账号？</el-text></el-divider>
          <el-button style="width:100%;" @click="goRegister">注 册</el-button>
          <p class="login-hint">默认账号 <strong>admin</strong>，密码 <strong>admin123</strong></p>
        </el-card>
      </div>
    </div>
  `,
  setup() {
    const router  = useRouter();
    const formRef = ref(null);
    const loading = ref(false);
    const form    = reactive({ username: '', password: '' });
    const rules   = {
      username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
      password: [{ required: true, message: '请输入密码',   trigger: 'blur' }],
    };

    // 后端连接状态：checking / online / offline
    const apiStatus = ref('checking');
    const apiStatusText = computed(() => ({
      checking: '正在检测后端连接...',
      online:   '后端已连接',
      offline:  '后端未启动（请先运行 python app.py）',
    }[apiStatus.value]));

    onMounted(async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(API_BASE + '/api/health', { signal: controller.signal });
        clearTimeout(timer);
        // 任何有效 HTTP 响应（包括 401）都说明后端在线
        apiStatus.value = 'online';
      } catch {
        apiStatus.value = 'offline';
      }
    });

    const submit = () => {
      formRef.value.validate(async (ok) => {
        if (!ok) return;
        loading.value = true;
        try {
          const data = await request('POST', '/api/auth/login', {
            username: form.username,
            password: form.password,
          });
          localStorage.setItem('tf_token', data.token);
          localStorage.setItem('tf_user',  data.username);
          ElMessage({ type: 'success', message: `欢迎回来，${data.username}`, duration: 2000 });
          router.push('/tasks');
        } catch (e) {
          ElMessage.error(e.message);
        }
        loading.value = false;
      });
    };

    const goRegister = () => router.push('/register');

    return {
      form, rules, formRef, loading, submit, goRegister, apiStatus, apiStatusText,
      icons: { User: ElementPlusIconsVue.User, Lock: ElementPlusIconsVue.Lock },
    };
  },
};

/* ==================== 注册页 ==================== */
const RegisterPage = {
  template: `
    <div class="login-bg">
      <div class="login-wrap" style="animation: fadeUp .45s ease;">
        <el-card class="login-card" shadow="always">
          <div class="login-logo">
            <div class="logo-mark">
              <el-icon :size="22" color="#fff"><Check /></el-icon>
            </div>
            <span class="logo-text">TaskFlow</span>
          </div>
          <p class="login-sub">创建你的账号</p>

          <el-form :model="form" :rules="rules" ref="formRef" label-position="top" size="large">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="form.username" placeholder="2-20个字符" :prefix-icon="icons.User" clearable />
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input v-model="form.password" type="password" placeholder="至少6位" :prefix-icon="icons.Lock" show-password />
            </el-form-item>
            <el-form-item label="确认密码" prop="confirm">
              <el-input v-model="form.confirm" type="password" placeholder="再次输入密码" :prefix-icon="icons.Lock" show-password @keyup.enter="submit" />
            </el-form-item>
            <el-form-item style="margin-top:4px;">
              <el-button class="login-submit-btn" type="primary" size="large" :loading="loading" @click="submit">注 册</el-button>
            </el-form-item>
          </el-form>

          <el-button style="width:100%;margin-top:12px;" @click="router.push('/login')">已有账号，去登录</el-button>
        </el-card>
      </div>
    </div>
  `,
  setup() {
    const router  = useRouter();
    const formRef = ref(null);
    const loading = ref(false);
    const form    = reactive({ username: '', password: '', confirm: '' });
    const rules   = {
      username: [{ required: true, message: '请输入用户名', trigger: 'blur' }, { min: 2, message: '至少2个字符', trigger: 'blur' }],
      password: [{ required: true, message: '请输入密码', trigger: 'blur' }, { min: 6, message: '至少6位', trigger: 'blur' }],
      confirm:  [
        { required: true, message: '请确认密码', trigger: 'blur' },
        {
          validator: (rule, val, cb) => val === form.password ? cb() : cb(new Error('两次密码不一致')),
          trigger: 'blur',
        },
      ],
    };

    const submit = () => {
      formRef.value.validate(async (ok) => {
        if (!ok) return;
        loading.value = true;
        try {
          const data = await request('POST', '/api/auth/register', {
            username: form.username,
            password: form.password,
          });
          localStorage.setItem('tf_token', data.token);
          localStorage.setItem('tf_user',  data.username);
          ElMessage({ type: 'success', message: '注册成功！', duration: 2000 });
          router.push('/tasks');
        } catch (e) {
          ElMessage.error(e.message);
        }
        loading.value = false;
      });
    };

    return {
      form, rules, formRef, loading, submit, router,
      icons: { User: ElementPlusIconsVue.User, Lock: ElementPlusIconsVue.Lock },
    };
  },
};

/* ==================== 任务列表页 ==================== */
const TasksPage = {
  template: `
    <el-container class="app-layout" v-loading="pageLoading" element-loading-text="加载中...">

      <!-- 侧边栏 -->
      <el-aside :width="collapsed ? '64px' : '240px'" class="sidebar">
        <div class="sidebar-top">
          <div class="logo-row">
            <div class="logo-mark" :class="{ sm: collapsed }">
              <el-icon :size="collapsed ? 16 : 20" color="#fff"><Check /></el-icon>
            </div>
            <transition name="fade">
              <span v-if="!collapsed" class="logo-text">TaskFlow</span>
            </transition>
          </div>
        </div>

        <div class="sidebar-nav">
          <p v-if="!collapsed" class="nav-group-label">视图</p>
          <div v-for="item in navItems" :key="item.key" class="nav-item" :class="{ active: filter === item.key }" @click="setFilter(item.key)">
            <el-tooltip :content="item.label" placement="right" :disabled="!collapsed">
              <el-icon :size="18"><component :is="item.icon" /></el-icon>
            </el-tooltip>
            <transition name="fade">
              <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
            </transition>
            <transition name="fade">
              <el-badge v-if="!collapsed && item.count" :value="item.count" class="nav-count" />
            </transition>
          </div>

          <p v-if="!collapsed" class="nav-group-label" style="margin-top:18px;">
            分类
            <el-button text size="small" style="padding:0;" @click="catDlg.show=true; catForm.name=''; catForm.color=COLORS[0];">
              <el-icon><Plus /></el-icon>
            </el-button>
          </p>
          <div v-for="cat in categories" :key="cat.id" class="nav-item cat-nav-item" :class="{ active: filter === cat.id }" @click="setFilter(cat.id)">
            <el-tooltip :content="cat.name" placement="right" :disabled="!collapsed">
              <span class="cat-dot" :style="{ background: cat.color }"></span>
            </el-tooltip>
            <transition name="fade">
              <span v-if="!collapsed" class="nav-label">{{ cat.name }}</span>
            </transition>
            <transition name="fade">
              <span v-if="!collapsed" class="cat-count-badge">{{ tasks.filter(t=>t.category===cat.id).length || '' }}</span>
            </transition>
            <transition name="fade">
              <el-button v-if="!collapsed" text circle size="small" class="cat-del-btn" @click.stop="deleteCategoryApi(cat.id)">
                <el-icon size="12"><Close /></el-icon>
              </el-button>
            </transition>
          </div>
        </div>

        <div v-if="!collapsed" class="sidebar-footer">
          <el-avatar :size="34" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);font-size:14px;font-weight:700;flex-shrink:0;">
            {{ username[0]?.toUpperCase() }}
          </el-avatar>
          <div class="user-meta">
            <div class="user-name">{{ username }}</div>
            <div class="user-role">管理员</div>
          </div>
          <el-tooltip content="退出登录" placement="top">
            <el-button text circle class="logout-btn" @click="logout">
              <el-icon :size="18"><SwitchButton /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </el-aside>

      <!-- 右侧 -->
      <el-container style="overflow:hidden;flex-direction:column;">
        <!-- 顶部栏 -->
        <el-header class="topbar" height="64px">
          <div class="topbar-left">
            <el-button text circle @click="collapsed=!collapsed" class="collapse-btn">
              <el-icon :size="20"><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
            </el-button>
            <h2 class="page-title">{{ pageTitle }}</h2>
          </div>
          <div class="topbar-right">
            <el-input v-model="searchQ" placeholder="搜索任务..." :prefix-icon="icons.Search" clearable style="width:220px;" />
            <el-tooltip :content="isDark ? '切换浅色' : '切换深色'" placement="bottom">
              <el-button text circle class="theme-btn" @click="toggleTheme">
                <el-icon :size="20"><Moon v-if="!isDark" /><Sunny v-else /></el-icon>
              </el-button>
            </el-tooltip>
            <el-button type="primary" :icon="icons.Plus" @click="openTaskDlg(null)">新建任务</el-button>
          </div>
        </el-header>

        <!-- 主内容 -->
        <el-main class="main-body">
          <!-- 统计卡片 -->
          <el-row :gutter="14" class="stats-row">
            <el-col :xs="12" :sm="6" v-for="s in statsCards" :key="s.label">
              <el-card class="stat-card" shadow="never">
                <div class="stat-num" :style="{ color: s.color }">{{ s.value }}</div>
                <div class="stat-label">{{ s.label }}</div>
                <el-icon :size="38" :style="{ color: s.color, opacity:.12 }" class="stat-bg-icon">
                  <component :is="s.icon" />
                </el-icon>
              </el-card>
            </el-col>
          </el-row>

          <!-- 筛选排序 -->
          <div class="filter-bar">
            <div class="filter-left">
              <el-button v-for="p in pOpts" :key="p.val"
                :type="priorityF===p.val ? p.btnType : ''"
                :plain="priorityF!==p.val"
                size="small" round @click="priorityF=p.val">{{ p.label }}</el-button>
            </div>
            <el-select v-model="sortBy" size="small" style="width:180px;">
              <el-option label="最新创建"         value="created_desc" />
              <el-option label="最早创建"         value="created_asc"  />
              <el-option label="截止日期（近→远）" value="due_asc"      />
              <el-option label="截止日期（远→近）" value="due_desc"     />
              <el-option label="按优先级"         value="priority"     />
            </el-select>
          </div>

          <!-- 任务列表 -->
          <div class="task-list">
            <transition-group name="task-list-anim">
              <el-card v-for="task in visibleTasks" :key="task.id"
                class="task-card" :class="{ done: task.status==='done' }" shadow="never">
                <div class="task-row">
                  <el-checkbox :model-value="task.status==='done'" @change="toggleTaskApi(task.id, task.status)" class="task-chk" />
                  <div class="task-body">
                    <div class="task-title">{{ task.title }}</div>
                    <div v-if="task.desc" class="task-desc">{{ task.desc }}</div>
                    <div class="task-tags">
                      <el-tag :type="PRIORITY_TYPE[task.priority]" size="small" effect="light" round>{{ PRIORITY_LABEL[task.priority] }}优先级</el-tag>
                      <el-tag v-if="getCat(task.category)" size="small" effect="plain" round
                        :style="{ borderColor: getCat(task.category).color, color: getCat(task.category).color }">
                        {{ getCat(task.category).name }}
                      </el-tag>
                      <el-tag v-if="task.due"
                        :type="isOverdue(task.due)&&task.status==='pending' ? 'danger' : isSoon(task.due)&&task.status==='pending' ? 'warning' : 'info'"
                        size="small" effect="plain" round>
                        <el-icon style="margin-right:3px;vertical-align:-2px;"><Calendar /></el-icon>
                        {{ isOverdue(task.due)&&task.status==='pending' ? '已逾期 · ' : '' }}{{ fmtDate(task.due) }}
                      </el-tag>
                    </div>
                  </div>
                  <div class="task-actions">
                    <el-tooltip content="编辑" placement="top">
                      <el-button text circle size="small" @click="openTaskDlg(task)"><el-icon><Edit /></el-icon></el-button>
                    </el-tooltip>
                    <el-tooltip content="删除" placement="top">
                      <el-button text circle size="small" type="danger" @click="confirmDeleteTask(task.id)"><el-icon><Delete /></el-icon></el-button>
                    </el-tooltip>
                  </div>
                </div>
              </el-card>
            </transition-group>
            <el-empty v-if="visibleTasks.length===0" description="暂无任务，点击「新建任务」开始吧" :image-size="120" style="padding:60px 0;" />
          </div>
        </el-main>
      </el-container>
    </el-container>

    <!-- 新建/编辑任务弹窗 -->
    <el-dialog v-model="taskDlg.show" :title="taskDlg.isEdit ? '编辑任务' : '新建任务'"
      width="500px" align-center :close-on-click-modal="false" destroy-on-close>
      <el-form :model="taskForm" :rules="taskRules" ref="taskFormRef" label-position="top">
        <el-form-item label="任务标题" prop="title">
          <el-input v-model="taskForm.title" placeholder="输入任务标题..." maxlength="100" show-word-limit clearable />
        </el-form-item>
        <el-form-item label="任务描述">
          <el-input v-model="taskForm.desc" type="textarea" placeholder="输入任务描述（可选）..." :rows="3" />
        </el-form-item>
        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="分类">
              <el-select v-model="taskForm.category" style="width:100%;" clearable placeholder="无分类">
                <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id">
                  <span class="cat-dot" :style="{ background: c.color, marginRight:'8px' }"></span>{{ c.name }}
                </el-option>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="优先级">
              <el-select v-model="taskForm.priority" style="width:100%;">
                <el-option label="🔴 高优先级" value="high" />
                <el-option label="🟡 中优先级" value="medium" />
                <el-option label="🟢 低优先级" value="low" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="截止日期">
              <el-date-picker v-model="taskForm.due" type="date" placeholder="选择日期" style="width:100%;" value-format="YYYY-MM-DD" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="taskForm.status" style="width:100%;">
                <el-option label="待完成" value="pending" />
                <el-option label="已完成" value="done" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="taskDlg.show=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTaskApi">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增分类弹窗 -->
    <el-dialog v-model="catDlg.show" title="新增分类" width="360px" align-center :close-on-click-modal="false" destroy-on-close>
      <el-form :model="catForm" :rules="catRules" ref="catFormRef" label-position="top">
        <el-form-item label="分类名称" prop="name">
          <el-input v-model="catForm.name" placeholder="例如：购物、旅行..." maxlength="20" show-word-limit @keyup.enter="saveCatApi" />
        </el-form-item>
        <el-form-item label="分类颜色">
          <div class="color-picker">
            <div v-for="c in COLORS" :key="c" class="color-swatch" :class="{ selected: catForm.color===c }" :style="{ background: c }" @click="catForm.color=c" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catDlg.show=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCatApi">创建</el-button>
      </template>
    </el-dialog>
  `,

  setup() {
    const router      = useRouter();
    const username    = ref(localStorage.getItem('tf_user') || '');
    const pageLoading = ref(false);
    const saving      = ref(false);

    /* ----- 主题 ----- */
    const isDark = ref(localStorage.getItem('tf_theme') === 'dark');
    const applyTheme = (dark) => {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('tf_theme', dark ? 'dark' : 'light');
    };
    applyTheme(isDark.value);
    const toggleTheme = () => { isDark.value = !isDark.value; applyTheme(isDark.value); };

    /* ----- 数据 ----- */
    const tasks      = ref([]);
    const categories = ref([]);

    const loadData = async () => {
      pageLoading.value = true;
      try {
        const [tasksRes, catsRes] = await Promise.all([
          request('GET', '/api/tasks'),
          request('GET', '/api/categories'),
        ]);
        tasks.value      = tasksRes.map(normalizeTask);
        categories.value = catsRes.map(normalizeCat);
      } catch (e) {
        ElMessage.error(e.message || '加载数据失败，请检查后端是否启动');
      }
      pageLoading.value = false;
    };

    /* ----- 布局 ----- */
    const collapsed = ref(false);
    const filter    = ref('all');
    const priorityF = ref('all');
    const sortBy    = ref('created_desc');
    const searchQ   = ref('');

    const setFilter  = (f) => { filter.value = f; };
    const pageTitle  = computed(() => {
      const map = { all:'全部任务', today:'今日任务', pending:'待完成', done:'已完成' };
      const cat = categories.value.find(c => c.id === filter.value);
      return cat ? cat.name : (map[filter.value] || '任务');
    });

    const navItems = computed(() => [
      { key:'all',     label:'全部任务', icon:'List',        count: tasks.value.length },
      { key:'today',   label:'今日任务', icon:'Calendar',    count: tasks.value.filter(t=>isToday(t.due)).length },
      { key:'pending', label:'待完成',   icon:'Clock',       count: tasks.value.filter(t=>t.status==='pending').length },
      { key:'done',    label:'已完成',   icon:'CircleCheck', count: tasks.value.filter(t=>t.status==='done').length },
    ]);

    const statsCards = computed(() => [
      { label:'总任务', value: tasks.value.length,                                                          color:'var(--el-color-primary)', icon:'List' },
      { label:'待完成', value: tasks.value.filter(t=>t.status==='pending').length,                         color:'var(--el-color-warning)', icon:'Clock' },
      { label:'已完成', value: tasks.value.filter(t=>t.status==='done').length,                            color:'var(--el-color-success)', icon:'CircleCheck' },
      { label:'已逾期', value: tasks.value.filter(t=>t.status==='pending'&&isOverdue(t.due)).length,       color:'var(--el-color-danger)',  icon:'Warning' },
    ]);

    const visibleTasks = computed(() => {
      let list = [...tasks.value];
      if (filter.value === 'today')   list = list.filter(t => isToday(t.due));
      else if (filter.value === 'pending') list = list.filter(t => t.status === 'pending');
      else if (filter.value === 'done')    list = list.filter(t => t.status === 'done');
      else if (filter.value !== 'all')     list = list.filter(t => t.category === filter.value);
      if (priorityF.value !== 'all') list = list.filter(t => t.priority === priorityF.value);
      if (searchQ.value) {
        const q = searchQ.value.toLowerCase();
        list = list.filter(t => t.title.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
      }
      list.sort((a, b) => {
        if (sortBy.value === 'created_desc') return b.createdAt - a.createdAt;
        if (sortBy.value === 'created_asc')  return a.createdAt - b.createdAt;
        if (sortBy.value === 'due_asc')  { if (!a.due) return 1; if (!b.due) return -1; return a.due.localeCompare(b.due); }
        if (sortBy.value === 'due_desc') { if (!a.due) return 1; if (!b.due) return -1; return b.due.localeCompare(a.due); }
        if (sortBy.value === 'priority') { const o={high:0,medium:1,low:2}; return o[a.priority]-o[b.priority]; }
        return 0;
      });
      return list;
    });

    const pOpts = [
      { val:'all',    label:'全部',  btnType:'primary' },
      { val:'high',   label:'🔴 高', btnType:'danger'  },
      { val:'medium', label:'🟡 中', btnType:'warning' },
      { val:'low',    label:'🟢 低', btnType:'success' },
    ];

    const getCat = (id) => categories.value.find(c => c.id === id);

    /* ----- 任务操作（API） ----- */
    const toggleTaskApi = async (id, currentStatus) => {
      const newStatus = currentStatus === 'done' ? 'pending' : 'done';
      try {
        const updated = await request('PUT', `/api/tasks/${id}`, { status: newStatus });
        const idx = tasks.value.findIndex(t => t.id === String(id));
        if (idx !== -1) tasks.value[idx] = normalizeTask(updated);
        ElMessage({ type:'success', message: newStatus==='done' ? '任务已完成 🎉' : '任务已恢复', duration:1500 });
      } catch (e) { ElMessage.error(e.message); }
    };

    const confirmDeleteTask = (id) => {
      ElMessageBox.confirm('确定要删除这个任务吗？此操作不可撤销。', '确认删除', {
        confirmButtonText:'删除', cancelButtonText:'取消', type:'warning',
      }).then(async () => {
        try {
          await request('DELETE', `/api/tasks/${id}`);
          tasks.value = tasks.value.filter(t => t.id !== String(id));
          ElMessage({ type:'info', message:'任务已删除' });
        } catch (e) { ElMessage.error(e.message); }
      }).catch(() => {});
    };

    /* ----- 任务弹窗 ----- */
    const taskFormRef = ref(null);
    const taskDlg  = reactive({ show:false, isEdit:false, editId:null });
    const taskForm = reactive({ title:'', desc:'', category:'', priority:'medium', due:'', status:'pending' });
    const taskRules = { title:[{ required:true, message:'请输入任务标题', trigger:'blur' }] };

    const openTaskDlg = (task) => {
      if (task) {
        taskDlg.isEdit = true; taskDlg.editId = task.id;
        Object.assign(taskForm, { title:task.title, desc:task.desc, category:task.category, priority:task.priority, due:task.due, status:task.status });
      } else {
        taskDlg.isEdit = false; taskDlg.editId = null;
        const defaultCat = filter.value !== 'all' && filter.value !== 'today' && filter.value !== 'pending' && filter.value !== 'done' ? filter.value : (categories.value[0]?.id || '');
        Object.assign(taskForm, { title:'', desc:'', category:defaultCat, priority:'medium', due:'', status:'pending' });
      }
      taskDlg.show = true;
    };

    const saveTaskApi = () => {
      taskFormRef.value.validate(async (ok) => {
        if (!ok) return;
        saving.value = true;
        try {
          const payload = taskToPayload(taskForm);
          if (taskDlg.isEdit) {
            const updated = await request('PUT', `/api/tasks/${taskDlg.editId}`, payload);
            const idx = tasks.value.findIndex(t => t.id === taskDlg.editId);
            if (idx !== -1) tasks.value[idx] = normalizeTask(updated);
            ElMessage.success('任务已更新');
          } else {
            const created = await request('POST', '/api/tasks', payload);
            tasks.value.unshift(normalizeTask(created));
            ElMessage.success('任务创建成功');
          }
          taskDlg.show = false;
        } catch (e) { ElMessage.error(e.message); }
        saving.value = false;
      });
    };

    /* ----- 分类操作（API） ----- */
    const catFormRef = ref(null);
    const catDlg  = reactive({ show:false });
    const catForm = reactive({ name:'', color:COLORS[0] });
    const catRules = { name:[{ required:true, message:'请输入分类名称', trigger:'blur' }] };

    const saveCatApi = () => {
      catFormRef.value.validate(async (ok) => {
        if (!ok) return;
        saving.value = true;
        try {
          const created = await request('POST', '/api/categories', { name:catForm.name.trim(), color:catForm.color });
          categories.value.push(normalizeCat(created));
          catDlg.show = false;
          ElMessage.success('分类创建成功');
        } catch (e) { ElMessage.error(e.message); }
        saving.value = false;
      });
    };

    const deleteCategoryApi = async (id) => {
      try {
        await request('DELETE', `/api/categories/${id}`);
        categories.value = categories.value.filter(c => c.id !== id);
        if (filter.value === id) filter.value = 'all';
        ElMessage({ type:'info', message:'分类已删除' });
      } catch (e) { ElMessage.error(e.message); }
    };

    /* ----- 退出登录 ----- */
    const logout = () => {
      ElMessageBox.confirm('确定要退出登录吗？', '退出登录', {
        confirmButtonText:'退出', cancelButtonText:'取消', type:'warning',
      }).then(() => {
        localStorage.removeItem('tf_token');
        localStorage.removeItem('tf_user');
        router.push('/login');
      }).catch(() => {});
    };

    /* ----- 快捷键 ----- */
    const onKey = (e) => {
      if ((e.ctrlKey||e.metaKey) && e.key==='n' && !taskDlg.show) { e.preventDefault(); openTaskDlg(null); }
    };
    onMounted(() => { loadData(); document.addEventListener('keydown', onKey); });
    onUnmounted(() => document.removeEventListener('keydown', onKey));

    return {
      username, pageLoading, saving, isDark, collapsed, filter, priorityF, sortBy, searchQ,
      tasks, categories, navItems, pageTitle, statsCards, visibleTasks, pOpts, COLORS,
      PRIORITY_TYPE, PRIORITY_LABEL,
      setFilter, toggleTheme, getCat, toggleTaskApi, confirmDeleteTask, logout, fmtDate, isOverdue, isSoon,
      taskFormRef, taskDlg, taskForm, taskRules, openTaskDlg, saveTaskApi,
      catFormRef, catDlg, catForm, catRules, saveCatApi, deleteCategoryApi,
      icons: { Search: ElementPlusIconsVue.Search, Plus: ElementPlusIconsVue.Plus },
    };
  },
};

/* ==================== 路由 ==================== */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/',          redirect: '/login' },
    { path: '/login',     component: LoginPage },
    { path: '/register',  component: RegisterPage },
    { path: '/tasks',     component: TasksPage, meta: { requiresAuth: true } },
  ],
});

router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth && !localStorage.getItem('tf_token')) next('/login');
  else next();
});

/* ==================== 挂载 ==================== */
const app = createApp({ template: '<router-view />' });
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) app.component(key, comp);
app.use(router);
app.use(ElementPlus);
app.mount('#app');
