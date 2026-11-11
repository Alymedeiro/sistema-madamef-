-- Dados de exemplo para desenvolvimento local (aplicado após as migrações).
-- Não cria usuários: a dona é criada com scripts/criar-dona.ts.

insert into public.configuracoes_clinica (nome, horario_funcionamento)
values (
  'Madame Fê Clinic',
  '{
    "0": [],
    "1": [{"inicio": "09:00", "fim": "19:00"}],
    "2": [{"inicio": "09:00", "fim": "19:00"}],
    "3": [{"inicio": "09:00", "fim": "19:00"}],
    "4": [{"inicio": "09:00", "fim": "19:00"}],
    "5": [{"inicio": "09:00", "fim": "19:00"}],
    "6": [{"inicio": "09:00", "fim": "19:00"}]
  }'::jsonb
);

insert into public.categorias_servico (nome)
values ('Estética facial'), ('Estética corporal');

insert into public.servicos (nome, categoria_id, descricao, duracao_min, preco_centavos, permite_online, exige_avaliacao, dias_retorno)
select s.nome, c.id, s.descricao, s.duracao_min, s.preco_centavos, s.permite_online, s.exige_avaliacao, s.dias_retorno
from (
  values
    ('Limpeza de pele', 'Estética facial', 'Limpeza de pele profunda', 60, 18000, true, false, 30),
    ('Peeling', 'Estética facial', 'Peeling químico', 45, 25000, false, true, 21),
    ('Drenagem linfática', 'Estética corporal', 'Drenagem linfática manual', 60, 15000, true, false, null)
) as s (nome, categoria, descricao, duracao_min, preco_centavos, permite_online, exige_avaliacao, dias_retorno)
join public.categorias_servico c on c.nome = s.categoria;

-- 0011: o estoque só muda por movimento; o inicial entra como ajuste.
insert into public.produtos (nome, unidade, estoque_minimo)
values ('Ácido glicólico 70%', 'ml', 100);

insert into public.movimentos_estoque (produto_id, tipo, quantidade, motivo)
select id, 'ajuste', 500, 'Estoque inicial' from public.produtos where nome = 'Ácido glicólico 70%';

insert into public.produtos_custos (produto_id, custo_unitario_centavos)
select id, 120 from public.produtos where nome = 'Ácido glicólico 70%';

insert into public.servico_produtos (servico_id, produto_id, quantidade)
select s.id, p.id, 2
from public.servicos s, public.produtos p
where s.nome = 'Peeling' and p.nome = 'Ácido glicólico 70%';
