'use strict';

const MILAN_UDAPI_SLUG = 'new-milan-hotel-udapi';

function menuItem(id, name, half, full) {
    const item = { id, name, enabled: true };
    const hasHalf = half != null && half !== '';
    const hasFull = full != null && full !== '';
    if (hasHalf && hasFull) {
        item.sizes = [
            { label: 'Half', price: Number(half) },
            { label: 'Full', price: Number(full) }
        ];
    } else if (hasFull) {
        item.price = Number(full);
    } else if (hasHalf) {
        item.price = Number(half);
    }
    return item;
}

function buildMilanUdapiMenuCatalog() {
    return {
        categories: [
            {
                id: 'drinks',
                name: 'Drinks',
                items: [
                    menuItem('tea', 'Tea', 5, 10),
                    menuItem('coffee', 'Coffee', null, 30),
                    menuItem('bournvita', 'Bournvita', null, 25),
                    menuItem('special-kt', 'Special KT', null, 25)
                ]
            },
            {
                id: 'breakfast',
                name: 'Breakfast',
                items: [
                    menuItem('uppit', 'Uppit', null, 25),
                    menuItem('shira', 'Shira', null, 30),
                    menuItem('shira-uppit-mix', 'Shira Uppit Mix', null, 30),
                    menuItem('poha', 'Poha', null, 25),
                    menuItem('idli', 'Idli', 20, 40),
                    menuItem('vada', 'Vada', 20, 40),
                    menuItem('idli-vada', 'Idli Vada', 40, 60),
                    menuItem('puri-kurma-bhaji', 'Puri Kurma or Bhaji', 35, 60),
                    menuItem('rice-phulav', 'Rice Phulav', null, 50),
                    menuItem('misal-pav', 'Misal Pav', null, 50),
                    menuItem('masala-dosa', 'Masala Dosa', null, 60),
                    menuItem('uttappa', 'Uttappa', null, 70),
                    menuItem('akki-dosa', 'Akki Dosa', 35, 70)
                ]
            }
        ]
    };
}

module.exports = { MILAN_UDAPI_SLUG, buildMilanUdapiMenuCatalog };
