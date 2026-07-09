FROM php:8.2-apache

RUN docker-php-ext-install pdo pdo_mysql \
    && a2enmod rewrite

# .htaccess の RewriteRule を有効にする
RUN sed -i 's/AllowOverride None/AllowOverride All/g' \
    /etc/apache2/apache2.conf \
    /etc/apache2/sites-available/000-default.conf

WORKDIR /var/www/html
