import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { login } from '../lib/api.js';

const schema = z.object({ login: z.string().min(1, 'Informe o login'), password: z.string().min(1, 'Informe a senha') });

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async (data) => {
    try {
      await login(data.login, data.password);
      await queryClient.invalidateQueries();
      navigate('/');
    } catch (error) {
      setError('root', { message: error.message });
    }
  });

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand"><span className="brand-mark">◇</span><div><strong>SAO RPG</strong><small>Database</small></div></div>
        <h1>Entrar</h1>
        <label>Login<input autoComplete="username" {...register('login')} /></label>
        {errors.login && <span className="field-error">{errors.login.message}</span>}
        <label>Senha<input type="password" autoComplete="current-password" {...register('password')} /></label>
        {errors.password && <span className="field-error">{errors.password.message}</span>}
        {errors.root && <div className="alert error">{errors.root.message}</div>}
        <button className="primary" disabled={isSubmitting}>{isSubmitting ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}
