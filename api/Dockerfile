# Dev-only image — boots `rails server` against the live-mounted source (see
# docker-compose.yml volumes). Not the multi-stage image you'd deploy with;
# this take-home only needs "runs locally via README", not a production build.
FROM ruby:4.0-slim

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
      libyaml-dev \
      postgresql-client \
      git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Gemfile Gemfile.lock ./
RUN bundle install

COPY . .

EXPOSE 3000

CMD ["bash", "-c", "bin/rails db:prepare && bin/rails server -b 0.0.0.0 -p 3000"]
