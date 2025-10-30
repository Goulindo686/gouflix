// Sistema de Autenticação GouFlix
class AuthSystem {
  constructor() {
    this.currentScreen = 'login';
    this.selectedAvatar = null;
    this.avatarList = [];
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadAvatars();
    this.checkAuthStatus();
  }

  bindEvents() {
    // Navegação entre telas
    document.getElementById('showRegisterBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showScreen('register');
    });

    document.getElementById('showLoginBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showScreen('login');
    });

    // Formulários
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin(e);
    });

    document.getElementById('registerForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister(e);
    });

    document.getElementById('profileForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleCreateProfile(e);
    });

    // Botões Discord
    document.getElementById('discordLoginBtn')?.addEventListener('click', () => {
      this.handleDiscordAuth();
    });

    document.getElementById('discordRegisterBtn')?.addEventListener('click', () => {
      this.handleDiscordAuth();
    });

    // Perfil
    document.getElementById('cancelProfileBtn')?.addEventListener('click', () => {
      this.showScreen('profileSelect');
    });

    document.getElementById('logoutFromProfilesBtn')?.addEventListener('click', () => {
      this.handleLogout();
    });

    // Contador de caracteres do nome do perfil
    const profileNameInput = document.getElementById('profileName');
    if (profileNameInput) {
      profileNameInput.addEventListener('input', (e) => {
        const count = e.target.value.length;
        const counter = document.querySelector('.profile-avatar-section p');
        if (counter) {
          counter.textContent = `${count}/50 caracteres`;
        }
      });
    }
  }

  showScreen(screenName) {
    // Esconder todas as telas
    document.querySelectorAll('.auth-screen').forEach(screen => {
      screen.classList.remove('active');
    });

    // Mostrar tela solicitada
    const targetScreen = document.getElementById(`${screenName}Screen`);
    if (targetScreen) {
      targetScreen.classList.add('active');
      this.currentScreen = screenName;
    }
  }

  showLoading(show = true) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.toggle('active', show);
    }
  }

  async checkAuthStatus() {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();
      
      if (data.logged && data.user) {
        // Verificar se possui perfil criado
        try {
          const r = await fetch('/api/auth/profile');
          const pj = await r.json();
          if (pj && pj.success && pj.user && pj.user.hasProfile) {
            // Já tem perfil, ir para home
            window.location.href = '/';
            return;
          }
          // Sem perfil: mostrar criação
          this.showScreen('profile');
        } catch (_err) {
          this.showScreen('profile');
        }
      } else {
        this.showScreen('login');
      }
    } catch (error) {
      console.error('Erro ao verificar status de autenticação:', error);
      this.showScreen('login');
    }
  }

  async handleLogin(event) {
    const formData = new FormData(event.target);
    const email = formData.get('email');
    const password = formData.get('password');

    if (!email || !password) {
      this.showError('Por favor, preencha todos os campos.');
      return;
    }

    this.showLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.success) {
        // Login bem-sucedido, verificar perfis
        const profiles = await this.loadUserProfiles(data.user.id);
        if (profiles && profiles.length > 0) {
          this.showProfileSelection(profiles);
        } else {
          this.showScreen('profile');
        }
      } else {
        this.showError(data.message || 'Erro ao fazer login. Verifique suas credenciais.');
      }
    } catch (error) {
      console.error('Erro no login:', error);
      this.showError('Erro de conexão. Tente novamente.');
    } finally {
      this.showLoading(false);
    }
  }

  async handleRegister(event) {
    const formData = new FormData(event.target);
    const name = formData.get('name');
    const email = formData.get('email');
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');

    if (!name || !email || !password || !confirmPassword) {
      this.showError('Por favor, preencha todos os campos.');
      return;
    }

    if (password !== confirmPassword) {
      this.showError('As senhas não coincidem.');
      return;
    }

    if (password.length < 6) {
      this.showError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    this.showLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: name, email, password }),
      });

      const data = await response.json();

      if (data.success) {
        // Cadastro bem-sucedido, ir para login
        this.showScreen('login');
      } else {
        this.showError(data.message || 'Erro ao criar conta. Tente novamente.');
      }
    } catch (error) {
      console.error('Erro no cadastro:', error);
      this.showError('Erro de conexão. Tente novamente.');
    } finally {
      this.showLoading(false);
    }
  }

  async handleCreateProfile(event) {
    const formData = new FormData(event.target);
    const profileName = formData.get('profileName');

    if (!profileName || !this.selectedAvatar) {
      this.showError('Por favor, preencha o nome e selecione um avatar.');
      return;
    }

    this.showLoading(true);

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profileName,
          avatar: this.selectedAvatar?.url || '',
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Perfil criado com sucesso, redirecionar para o site
        window.location.href = '/';
      } else {
        this.showError(data.message || 'Erro ao criar perfil. Tente novamente.');
      }
    } catch (error) {
      console.error('Erro ao criar perfil:', error);
      this.showError('Erro de conexão. Tente novamente.');
    } finally {
      this.showLoading(false);
    }
  }

  handleDiscordAuth() {
    window.location.href = '/api/auth/discord/start';
  }

  async handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      this.showScreen('login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  }

  async loadAvatars() {
    try {
      // Gerar lista de avatares disponíveis (usando uma API de avatares ou lista local)
      this.avatarList = [];
      
      // Avatares do sistema (usando DiceBear API como exemplo)
      const styles = ['avataaars', 'big-smile', 'bottts', 'croodles', 'fun-emoji', 'icons', 'identicon', 'initials', 'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art', 'shapes'];
      
      for (let i = 0; i < 404; i++) {
        const style = styles[i % styles.length];
        const seed = `avatar-${i}`;
        this.avatarList.push({
          id: i,
          url: `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}&size=60`,
          style,
          seed
        });
      }

      this.renderAvatarGrid();
    } catch (error) {
      console.error('Erro ao carregar avatares:', error);
    }
  }

  renderAvatarGrid() {
    const grid = document.getElementById('avatarGrid');
    if (!grid) return;

    grid.innerHTML = '';

    this.avatarList.forEach(avatar => {
      const avatarElement = document.createElement('div');
      avatarElement.className = 'avatar-option';
      avatarElement.innerHTML = `<img src="${avatar.url}" alt="Avatar ${avatar.id}">`;
      
      avatarElement.addEventListener('click', () => {
        this.selectAvatar(avatar, avatarElement);
      });

      grid.appendChild(avatarElement);
    });
  }

  selectAvatar(avatar, element) {
    // Remover seleção anterior
    document.querySelectorAll('.avatar-option').forEach(el => {
      el.classList.remove('selected');
    });

    // Selecionar novo avatar
    element.classList.add('selected');
    this.selectedAvatar = avatar;

    // Atualizar preview
    const preview = document.getElementById('selectedAvatar');
    const previewContainer = document.querySelector('.avatar-preview');
    if (preview && previewContainer) {
      preview.src = avatar.url;
      preview.alt = `Avatar ${avatar.id}`;
      previewContainer.classList.add('has-image');
    }
  }

  async loadUserProfiles(userId) {
    try {
      const response = await fetch(`/api/profiles/list?userId=${userId}`);
      const data = await response.json();
      return data.profiles || [];
    } catch (error) {
      console.error('Erro ao carregar perfis:', error);
      return [];
    }
  }

  showProfileSelection(profiles) {
    const grid = document.getElementById('profilesGrid');
    if (!grid) return;

    // Limpar grid mantendo apenas o botão "Adicionar Perfil"
    const addProfileBtn = grid.querySelector('.add-profile');
    grid.innerHTML = '';
    
    // Adicionar perfis existentes
    profiles.forEach(profile => {
      const profileElement = document.createElement('div');
      profileElement.className = 'profile-item';
      profileElement.innerHTML = `
        <div class="profile-avatar">
          <img src="${profile.avatar}" alt="${profile.name}">
        </div>
        <span>${profile.name}</span>
      `;
      
      profileElement.addEventListener('click', () => {
        this.selectProfile(profile);
      });

      grid.appendChild(profileElement);
    });

    // Re-adicionar botão "Adicionar Perfil"
    if (addProfileBtn) {
      grid.appendChild(addProfileBtn);
      addProfileBtn.addEventListener('click', () => {
        this.showScreen('profile');
      });
    }

    this.showScreen('profileSelect');
  }

  async selectProfile(profile) {
    this.showLoading(true);

    try {
      const response = await fetch('/api/profiles/select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profileId: profile.id }),
      });

      const data = await response.json();

      if (data.success) {
        // Perfil selecionado com sucesso, redirecionar para o site
        window.location.href = '/';
      } else {
        this.showError(data.message || 'Erro ao selecionar perfil.');
      }
    } catch (error) {
      console.error('Erro ao selecionar perfil:', error);
      this.showError('Erro de conexão. Tente novamente.');
    } finally {
      this.showLoading(false);
    }
  }

  showError(message) {
    // Criar ou atualizar elemento de erro
    let errorElement = document.querySelector('.auth-error');
    
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.className = 'auth-error';
      errorElement.style.cssText = `
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #fca5a5;
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 0.9rem;
        text-align: center;
      `;
    }

    errorElement.textContent = message;

    // Inserir no card ativo
    const activeCard = document.querySelector('.auth-screen.active .auth-card');
    if (activeCard) {
      const existingError = activeCard.querySelector('.auth-error');
      if (existingError) {
        existingError.remove();
      }
      activeCard.insertBefore(errorElement, activeCard.firstChild);
    }

    // Remover erro após 5 segundos
    setTimeout(() => {
      errorElement.remove();
    }, 5000);
  }
}

// Inicializar sistema quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
  new AuthSystem();
});