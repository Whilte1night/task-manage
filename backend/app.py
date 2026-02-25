"""
TaskFlow 后端 - Flask + SQLite
接口列表：
  POST   /api/auth/login              登录
  POST   /api/auth/register           注册
  GET    /api/auth/me                 获取当前用户信息

  GET    /api/tasks                   获取所有任务
  POST   /api/tasks                   新建任务
  PUT    /api/tasks/<id>              修改任务
  DELETE /api/tasks/<id>              删除任务

  GET    /api/categories              获取所有分类
  POST   /api/categories              新建分类
  PUT    /api/categories/<id>         修改分类名称/颜色
  DELETE /api/categories/<id>         删除分类
"""

from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import os

# ==================== 初始化 ====================
app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(BASE_DIR, "taskflow.db")}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# 生产环境请设置 JWT_SECRET_KEY 环境变量，本地开发保留默认值
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'taskflow-super-secret-2024')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)
# JWT 配置：禁用 CSRF 保护（前后端分离不需要）
app.config['JWT_COOKIE_CSRF_PROTECT'] = False
app.config['JWT_CSRF_CHECK_FORM'] = False

db  = SQLAlchemy(app)
jwt = JWTManager(app)

# 允许跨域（前后端分离必须配置）
CORS(app, resources={
    r'/api/*': {
        'origins': '*',
        'methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        'allow_headers': ['Content-Type', 'Authorization'],
        'expose_headers': ['Content-Type', 'Authorization'],
        'supports_credentials': False
    }
})

# 手动处理 OPTIONS 请求
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response


# ==================== 数据模型 ====================
class User(db.Model):
    __tablename__ = 'users'

    id           = db.Column(db.Integer, primary_key=True)
    username     = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)

    tasks      = db.relationship('Task',     backref='user', lazy=True, cascade='all, delete-orphan')
    categories = db.relationship('Category', backref='user', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {'id': self.id, 'username': self.username}


class Category(db.Model):
    __tablename__ = 'categories'

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name    = db.Column(db.String(50), nullable=False)
    color   = db.Column(db.String(20), default='#6366f1')

    tasks = db.relationship('Task', backref='category', lazy=True)

    def to_dict(self):
        return {'id': self.id, 'name': self.name, 'color': self.color}


class Task(db.Model):
    __tablename__ = 'tasks'

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=True)
    title       = db.Column(db.String(200), nullable=False)
    desc        = db.Column(db.Text, default='')
    priority    = db.Column(db.String(20), default='medium')   # high / medium / low
    status      = db.Column(db.String(20), default='pending')  # pending / done
    due_date    = db.Column(db.String(20), nullable=True)       # YYYY-MM-DD
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':          self.id,
            'title':       self.title,
            'desc':        self.desc or '',
            'category_id': self.category_id,
            'priority':    self.priority,
            'status':      self.status,
            'due_date':    self.due_date or '',
            'created_at':  self.created_at.isoformat(),
        }


# ==================== 工具函数 ====================
def ok(data=None, code=200):
    return jsonify(data if data is not None else {}), code

def err(msg, code=400):
    return jsonify({'message': msg}), code


# ==================== 健康检查 ====================
@app.route('/api/health', methods=['GET'])
def health():
    return ok({'status': 'ok'})


# ==================== 认证接口 ====================
@app.route('/api/auth/login', methods=['POST'])
def login():
    data     = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return err('请输入用户名和密码')

    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return err('用户名或密码错误', 401)

    token = create_access_token(identity=str(user.id))
    return ok({'token': token, 'username': user.username})


@app.route('/api/auth/register', methods=['POST'])
def register():
    data     = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return err('请输入用户名和密码')
    if len(username) < 2:
        return err('用户名至少 2 个字符')
    if len(password) < 6:
        return err('密码至少 6 位')
    if User.query.filter_by(username=username).first():
        return err('用户名已存在', 409)

    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)

    # 新用户自动创建默认分类
    for c in [('工作','#6366f1'), ('个人','#22c55e'), ('学习','#f59e0b'), ('健康','#ef4444')]:
        db.session.add(Category(user=user, name=c[0], color=c[1]))

    db.session.commit()
    token = create_access_token(identity=str(user.id))
    return ok({'token': token, 'username': user.username}, 201)


@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def me():
    user = User.query.get(get_jwt_identity())
    return ok(user.to_dict())


# ==================== 任务接口 ====================
@app.route('/api/tasks', methods=['GET'])
@jwt_required()
def get_tasks():
    user_id = int(get_jwt_identity())
    tasks = Task.query.filter_by(user_id=user_id)\
                      .order_by(Task.created_at.desc()).all()
    return ok([t.to_dict() for t in tasks])


@app.route('/api/tasks', methods=['POST'])
@jwt_required()
def create_task():
    user_id = int(get_jwt_identity())
    data    = request.get_json() or {}
    title   = data.get('title', '').strip()

    if not title:
        return err('任务标题不能为空')

    task = Task(
        user_id     = user_id,
        title       = title,
        desc        = data.get('desc', ''),
        category_id = data.get('category_id'),
        priority    = data.get('priority', 'medium'),
        status      = data.get('status', 'pending'),
        due_date    = data.get('due_date') or None,
    )
    db.session.add(task)
    db.session.commit()
    return ok(task.to_dict(), 201)


@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
@jwt_required()
def update_task(task_id):
    user_id = int(get_jwt_identity())
    task    = Task.query.filter_by(id=task_id, user_id=user_id).first()
    if not task:
        return err('任务不存在', 404)

    data = request.get_json() or {}
    if 'title'       in data: task.title       = data['title'].strip() or task.title
    if 'desc'        in data: task.desc        = data['desc']
    if 'category_id' in data: task.category_id = data['category_id']
    if 'priority'    in data: task.priority    = data['priority']
    if 'status'      in data: task.status      = data['status']
    if 'due_date'    in data: task.due_date    = data['due_date'] or None

    db.session.commit()
    return ok(task.to_dict())


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
@jwt_required()
def delete_task(task_id):
    user_id = int(get_jwt_identity())
    task    = Task.query.filter_by(id=task_id, user_id=user_id).first()
    if not task:
        return err('任务不存在', 404)

    db.session.delete(task)
    db.session.commit()
    return ok({'message': '删除成功'})


# ==================== 分类接口 ====================
@app.route('/api/categories', methods=['GET'])
@jwt_required()
def get_categories():
    user_id = int(get_jwt_identity())
    cats = Category.query.filter_by(user_id=user_id).all()
    return ok([c.to_dict() for c in cats])


@app.route('/api/categories', methods=['POST'])
@jwt_required()
def create_category():
    user_id = int(get_jwt_identity())
    data    = request.get_json() or {}
    name    = data.get('name', '').strip()

    if not name:
        return err('分类名称不能为空')
    if Category.query.filter_by(user_id=user_id, name=name).first():
        return err('分类名称已存在', 409)

    cat = Category(user_id=user_id, name=name, color=data.get('color', '#6366f1'))
    db.session.add(cat)
    db.session.commit()
    return ok(cat.to_dict(), 201)


@app.route('/api/categories/<int:cat_id>', methods=['PUT'])
@jwt_required()
def update_category(cat_id):
    user_id = int(get_jwt_identity())
    cat     = Category.query.filter_by(id=cat_id, user_id=user_id).first()
    if not cat:
        return err('分类不存在', 404)

    data = request.get_json() or {}
    name = data.get('name', '').strip()

    if name and name != cat.name:
        if Category.query.filter_by(user_id=user_id, name=name).first():
            return err('分类名称已存在', 409)
        cat.name = name

    if 'color' in data:
        cat.color = data['color']

    db.session.commit()
    return ok(cat.to_dict())


@app.route('/api/categories/<int:cat_id>', methods=['DELETE'])
@jwt_required()
def delete_category(cat_id):
    user_id = int(get_jwt_identity())
    cat     = Category.query.filter_by(id=cat_id, user_id=user_id).first()
    if not cat:
        return err('分类不存在', 404)
    if Task.query.filter_by(user_id=user_id, category_id=cat_id).first():
        return err('该分类下还有任务，无法删除', 400)

    db.session.delete(cat)
    db.session.commit()
    return ok({'message': '删除成功'})


# ==================== 初始化数据库（gunicorn 也能执行到） ====================
def init_db():
    with app.app_context():
        try:
            db.create_all()
            if not User.query.filter_by(username='admin').first():
                admin = User(
                    username      = 'admin',
                    password_hash = generate_password_hash('admin123')
                )
                db.session.add(admin)
                for c in [('工作','#6366f1'), ('个人','#22c55e'), ('学习','#f59e0b'), ('健康','#ef4444')]:
                    db.session.add(Category(user=admin, name=c[0], color=c[1]))
                db.session.commit()
                print('[OK] 默认账号已创建：admin / admin123')
        except Exception as e:
            print(f'[ERROR] 数据库初始化失败: {e}')

init_db()

# ==================== 启动 ====================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') != 'production'
    print(f'[OK] 后端启动成功：http://localhost:{port}')
    app.run(debug=debug, host='0.0.0.0', port=port)
