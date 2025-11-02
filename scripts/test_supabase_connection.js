#!/usr/bin/env node

/**
 * Teste de Conexão com Supabase
 * Verifica se as variáveis de ambiente estão configuradas corretamente
 */

require('dotenv').config();

async function testSupabaseConnection() {
    console.log('🔍 Testando conexão com Supabase...\n');
    
    // Verificar variáveis de ambiente
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        console.log('❌ Variáveis de ambiente faltando:');
        missing.forEach(varName => {
            console.log(`   - ${varName}`);
        });
        console.log('\n📝 Configure essas variáveis no arquivo .env');
        return false;
    }
    
    console.log('✅ Variáveis de ambiente encontradas');
    console.log(`   - SUPABASE_URL: ${process.env.SUPABASE_URL}`);
    console.log(`   - SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20)}...`);
    
    // Testar conexão
    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        console.log('\n🔗 Testando conexão...');
        
        // Testar consulta simples
        const { data, error } = await supabase
            .from('subscriptions')
            .select('count')
            .limit(1);
            
        if (error) {
            console.log('❌ Erro na conexão:', error.message);
            return false;
        }
        
        console.log('✅ Conexão com Supabase funcionando!');
        console.log('✅ Tabela "subscriptions" acessível');
        
        return true;
        
    } catch (error) {
        console.log('❌ Erro ao conectar:', error.message);
        return false;
    }
}

// Executar teste
testSupabaseConnection()
    .then(success => {
        if (success) {
            console.log('\n🎉 Tudo configurado corretamente!');
            console.log('   Agora o webhook deve funcionar e salvar no Supabase.');
        } else {
            console.log('\n⚠️  Configure as variáveis do Supabase no .env');
        }
    })
    .catch(error => {
        console.log('❌ Erro inesperado:', error.message);
    });