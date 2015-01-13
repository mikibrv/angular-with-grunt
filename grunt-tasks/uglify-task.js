module.exports = function (grunt) {
    grunt.config("uglify", {
        uglify: {
            options: {
                // the banner is inserted at the top of the output
                banner: '/*! <%= pkg.name %> <%= grunt.template.today("dd-mm-yyyy") %> */\n'
            },
            files: {
                '<%=env.root %>/app/app.js': ['<%=env.root %>/app/app.js']
            }
        }
    });
};