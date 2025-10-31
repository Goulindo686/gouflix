// Script para a página de autenticação
document.addEventListener('DOMContentLoaded', function() {
    // Elementos do DOM
    const registerCard = document.querySelector('.auth-card:not(.login-card)');
    const loginCard = document.getElementById('loginCard');
    const showLoginForm = document.getElementById('showLoginForm');
    const showRegisterForm = document.getElementById('showRegisterForm');
    const registerForm = document.getElementById('registerForm');
    const loginForm = document.getElementById('loginForm');
    const discordLoginBtn = document.getElementById('discordLoginBtn');
    const discordLoginBtn2 = document.getElementById('discordLoginBtn2');
    const backToHome = document.getElementById('backToHome');
    const backToHome2 = document.getElementById('backToHome2');

    // Alternar entre formulários
    showLoginForm.addEventListener('click', function(e) {
        e.preventDefault();
        registerCard.style.display = 'none';
        loginCard.style.display = 'block';
        loginCard.style.animation = 'slideUp 0.6s ease-out';
    });

    showRegisterForm.addEventListener('click', function(e) {
        e.preventDefault();
        loginCard.style.display = 'none';
        registerCard.style.display = 'block';
        registerCard.style.animation = 'slideUp 0.6s ease-out';
    });

    // Voltar para a home
    backToHome.addEventListener('click', function(e) {
        e.preventDefault();
        window.location.href = 'index.html';
    });

    backToHome2.addEventListener('click', function(e) {
        e.preventDefault();
        window.location.href = 'index.html';
    });

    // Login com Discord
    function handleDiscordLogin() {
        // Usar a API existente do projeto
        window.location.href = '/api/auth/discord/start';
    }

    discordLoginBtn.addEventListener('click', handleDiscordLogin);
    discordLoginBtn2.addEventListener('click', handleDiscordLogin);

    // Validação de formulário de registro
    registerForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = new FormData(registerForm);
        const fullName = formData.get('fullName').trim();
        const email = formData.get('email').trim();
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');
        const acceptTerms = document.getElementById('acceptTerms').checked;

        // Remover mensagens de erro anteriores
        removeMessage();

        // Validações
        if (!fullName) {
            showError('Por favor, insira seu nome completo.');
            return;
        }

        if (!isValidEmail(email)) {
            showError('Por favor, insira um email válido.');
            return;
        }

        if (password.length < 8) {
            showError('A senha deve ter pelo menos 8 caracteres.');
            return;
        }

        if (password !== confirmPassword) {
            showError('As senhas não coincidem.');
            return;
        }

        if (!acceptTerms) {
            showError('Você deve aceitar os termos de uso e política de privacidade.');
            return;
        }

    // Registrar via API (cookies de sessão, igual ao Discord)
    handleRegister(fullName, email, password);
    });

    // Validação de formulário de login
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = new FormData(loginForm);
        const email = formData.get('email').trim();
        const password = formData.get('password');

        // Remover mensagens de erro anteriores
        removeMessage();

        // Validações
        if (!isValidEmail(email)) {
            showError('Por favor, insira um email válido.');
            return;
        }

        if (!password) {
            showError('Por favor, insira sua senha.');
            return;
        }

    // Login via API (cookies de sessão, igual ao Discord)
    handleLogin(email, password);
    });

    // Função para validar email
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Função para mostrar erro
    function showError(message) {
        const activeCard = loginCard.style.display === 'block' ? loginCard : registerCard;
        const form = activeCard.querySelector('.auth-form');
        
        let errorDiv = activeCard.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            form.insertBefore(errorDiv, form.firstChild);
        }
        
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
    }

    // Função para mostrar sucesso
    function showSuccess(message) {
        const activeCard = loginCard.style.display === 'block' ? loginCard : registerCard;
        const form = activeCard.querySelector('.auth-form');
        
        let successDiv = activeCard.querySelector('.success-message');
        if (!successDiv) {
            successDiv = document.createElement('div');
            successDiv.className = 'success-message';
            form.insertBefore(successDiv, form.firstChild);
        }
        
        successDiv.textContent = message;
        successDiv.classList.add('show');
    }

    // Função para remover mensagens
    function removeMessage() {
        const messages = document.querySelectorAll('.error-message, .success-message');
        messages.forEach(msg => {
            msg.classList.remove('show');
            setTimeout(() => {
                if (msg.parentNode) {
                    msg.parentNode.removeChild(msg);
                }
            }, 300);
        });
    }

    // Função para adicionar loading ao botão
    function setButtonLoading(button, loading) {
        if (loading) {
            button.disabled = true;
            button.classList.add('loading');
        } else {
            button.disabled = false;
            button.classList.remove('loading');
        }
    }

    // Registro via API
    async function handleRegister(fullName, email, password) {
      const submitBtn = registerForm.querySelector('.btn-primary');
      setButtonLoading(submitBtn, true);

      try {
            const r = await fetch('/api/auth/register',{
              method:'POST',
              headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify({ fullName, email, password })
            });
            if(!r.ok){ const tx = await r.text(); throw new Error(tx||'Falha ao registrar'); }
            const js = await r.json();
            if(!(js && js.ok)) throw new Error(js && js.error || 'Erro ao registrar');
            showSuccess('Conta criada! Redirecionando...');
            setTimeout(()=>{ window.location.href = 'index.html'; }, 900);

        } catch (error) {
            showError('Erro ao criar conta. Tente novamente.');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    }

    // Login via API
    async function handleLogin(email, password) {
      const submitBtn = loginForm.querySelector('.btn-primary');
      setButtonLoading(submitBtn, true);

      try {
            const r = await fetch('/api/auth/login',{
              method:'POST',
              headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify({ email, password })
            });
            if(!r.ok){ const tx = await r.text(); throw new Error(tx||'Falha no login'); }
            const js = await r.json();
            if(!(js && js.ok)) throw new Error(js && js.error || 'Credenciais inválidas');
            showSuccess('Login realizado! Redirecionando...');
            setTimeout(()=>{ window.location.href = 'index.html'; }, 900);

        } catch (error) {
            showError('Não foi possível realizar o login.');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    }

    // Verificar se o usuário já está logado
    checkAuthStatus();

    async function checkAuthStatus() {
        // Verificar sessão no backend (Discord ou email)
        try {
            const response = await fetch('/api/auth/me');
            if (response.ok) {
                const data = await response.json();
                if (data.logged && data.user) {
                    window.location.href = 'index.html';
                }
            }
        } catch (error) {
            // Ignorar erro
        }
    }

    // Adicionar efeitos visuais aos inputs
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.parentElement.classList.add('focused');
        });

        input.addEventListener('blur', function() {
            if (!this.value) {
                this.parentElement.classList.remove('focused');
            }
        });

        // Verificar se já tem valor ao carregar
        if (input.value) {
            input.parentElement.classList.add('focused');
        }
    });
});